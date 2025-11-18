import { CommonModule } from '@angular/common';
import { Component, computed, Signal, signal, effect, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { Payment } from '../../models/payment.model';
import { GroupsService } from '../../Services/group/group';
import { AuthService } from '../../Services/auth/auth';
import { UsersService } from '../../Services/user/user';
import { CategoryPieChartComponent } from '../../components/pie-chart/pie-chart';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule, CategoryPieChartComponent, ReactiveFormsModule], 
  templateUrl: './home.html'
})
export class Home {

  isJoiningGroup = signal(false);
  addingExpense = signal(false);
  addExpenseLoading = signal(false);
  
  private allUsers = signal<User[]>([]);

  private groupService = inject(GroupsService);
  private authService = inject(AuthService);
  private usersService = inject(UsersService);
  private router = inject(Router);

  loading = this.groupService.loading;
  currentUser = this.authService.currentUser;
  groups = this.groupService.groups;

  // Form de adicionar gasto
  private fb = inject(NonNullableFormBuilder);

  addExpenseForm = this.fb.group({
    description: ['', [Validators.required]],
    value: [0, [Validators.required]],
    category: ['', [Validators.required]],
    groupId: ['', [Validators.required]]
  });

  constructor() {

    effect(() => {
      const user = this.currentUser();   
      if (user && user.uid) {
        (!this.groups()?.length) && !this.groupService.loaded() && this.groupService.loadUserGroups();
      }
    });

    effect(async () => {
      const groups = this.groups();
      if (!groups || groups.length === 0) {
        this.allUsers.set([]);
        return;
      }

      const memberIds = new Set(groups.flatMap(g => g.memberIds ? Object.keys(g.memberIds) : []));
      const payerIds = new Set(groups.flatMap(g => g.expenses ? Object.values(g.expenses).map(e => e.payerId) : []));
      
      const allIds = Array.from(new Set([...memberIds, ...payerIds]));
      const usersPromises = allIds.map(id => this.usersService.getUserById(id));
      const users = await Promise.all(usersPromises);

      this.allUsers.set(users.filter(u => u !== null) as User[]);
    });
  }

  private toCents(value: number | string): number {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) {
      return 0;
    }
    return Math.round(num * 100);
  }

  private allExpenses = computed(() => {
    const usersMap = new Map(this.allUsers().map(u => [u.uid, u.name]));
    
    return this.groups()?.flatMap(group => 
      group.expenses ? Object.values(group.expenses).map(expense => ({
        ...expense,
        groupName: group.name,
        payerName: usersMap.get(expense.payerId) || 'Usuário Desconhecido'
      })) : []
    );
  });

  private financialSummaryInCents = computed(() => {
    const myId = this.currentUser()?.uid; 
    const groups = this.groups();

    if (!myId || !groups || groups.length === 0) {
      return {
        totalUserPaidInCents: 0,
        totalUserShareInCents: 0,
        totalUserPaymentsSentInCents: 0,
        totalUserPaymentsReceivedInCents: 0
      };
    }

    let totalUserPaidInCents = 0;
    let totalUserShareInCents = 0;
    let totalUserPaymentsSentInCents = 0;
    let totalUserPaymentsReceivedInCents = 0;

    for (const group of groups) {
      const memberIds = group.memberIds ? Object.keys(group.memberIds) : [];
      const memberCount = memberIds.length;

      if (memberCount === 0 || !memberIds.includes(myId)) {
        continue;
      }

      const expenses = group.expenses ? Object.values(group.expenses) : [];
      const payments = group.payments ? Object.values(group.payments) : [];

      let totalGroupSpendInCents = 0;
      expenses.forEach(expense => {
        const expenseInCents = this.toCents(expense.value);
        totalGroupSpendInCents += expenseInCents;
        
        if (expense.payerId === myId) {
          totalUserPaidInCents += expenseInCents;
        }
      });

      if (totalGroupSpendInCents > 0) {
        const baseShareInCents = Math.floor(totalGroupSpendInCents / memberCount);
        const remainderCents = totalGroupSpendInCents % memberCount;

        const sortedMemberIds = [...memberIds].sort();
        const myIndex = sortedMemberIds.indexOf(myId);

        let myShareInCents = baseShareInCents;
        if (myIndex < remainderCents) {
          myShareInCents += 1;
        }
        totalUserShareInCents += myShareInCents;
      }

      payments.forEach(payment => {
        const paymentInCents = this.toCents(payment.value);
        if (payment.payerId === myId) {
          totalUserPaymentsSentInCents += paymentInCents;
        } else if (payment.targetId === myId) {
          totalUserPaymentsReceivedInCents += paymentInCents;
        }
      });
    }

    return { 
      totalUserPaidInCents, 
      totalUserShareInCents, 
      totalUserPaymentsSentInCents, 
      totalUserPaymentsReceivedInCents 
    };
  });

    

  private financialSummary = computed(() => {
    const myId = this.currentUser()?.uid; 
    const groups = this.groups();

    if (!myId || !groups || groups.length === 0) {
      return { totalUserPaid: 0, totalUserShare: 0 };
    }

    let totalUserPaid = 0;
    let totalUserShare = 0;

    for (const group of groups) {
      const numMembers = group.memberIds ? Object.keys(group.memberIds).length : 0;
      
      if (numMembers === 0) {
        continue;
      }

      if (group.expenses) {
        const expensesArray = Object.values(group.expenses);

        for (const expense of expensesArray) {
            const expenseValue = Number(expense.value) || 0; 

            const share = expenseValue / numMembers;
            totalUserShare += share;
            
            if (expense.payerId === myId) {
              totalUserPaid += expenseValue;
            }
        }
      }
    }
    
    return { totalUserPaid, totalUserShare };
  });

  owedToUser = computed(() => {
    return Math.max(0, this.netBalance());
  });

  userOwes = computed(() => {
    return Math.max(0, -this.netBalance());
  });

  netBalance = computed(() => {
    const { 
      totalUserPaidInCents, 
      totalUserShareInCents, 
      totalUserPaymentsSentInCents, 
      totalUserPaymentsReceivedInCents 
    } = this.financialSummaryInCents();

    const totalCreditsInCents = totalUserPaidInCents + totalUserPaymentsSentInCents;
    const totalDebitsInCents = totalUserShareInCents + totalUserPaymentsReceivedInCents;

    const netBalanceInCents = totalCreditsInCents - totalDebitsInCents;

    return netBalanceInCents / 100.0;
  });

  recentExpenses = computed(() => {
    const expenses = this.allExpenses();
    if (!expenses) return null;

    return expenses
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5); 
  });

  activeGroups = computed(() => {
    return this.groups()
      ?.map((group: Group) => {
        let lastActivityTime = 0;
        if (group.expenses && Object.keys(group.expenses).length > 0) {
          lastActivityTime = Math.max(
            0, 
            ...Object.values(group.expenses).map(e => new Date(e.date).getTime())
          );
        }
        return { ...group, lastActivityTime };
      })
      .sort((a, b) => b.lastActivityTime - a.lastActivityTime) 
      .slice(0, 3);
  });

  categoryBreakdown = computed(() => {
    const expenses = this.allExpenses();
    if (!expenses) return { labels: [], data: [] };

    const totalsInCents = new Map<string, number>();

    for (const exp of expenses) {
      const cat = exp.category || 'Sem categoria';
      const valInCents = this.toCents(exp.value); // Usa o helper
      totalsInCents.set(cat, (totalsInCents.get(cat) || 0) + valInCents);
    }

    const labels = Array.from(totalsInCents.keys());
    const data = Array.from(totalsInCents.values()).map(cents => cents / 100.0);

    return { labels, data };
  });

  openAddExpenseModal() {
    this.addingExpense.set(true);
  }

  async promptToJoinGroup() {
    const groupId = prompt("Digite o ID (código) do grupo que deseja entrar:");
    
    if (!groupId || groupId.trim() === '') {
      return;
    }

    this.isJoiningGroup.set(true);
    try {
      await this.groupService.joinGroup(groupId.trim());
      
      alert(`Sucesso! Você agora está no grupo!`);
    
    } catch (error: any) {
      console.error("Erro ao entrar no grupo:", error);

      if (error.message.includes('Grupo não encontrado')) {
        alert('Erro: Grupo não encontrado. Verifique o ID e tente novamente.');
      } else {
        alert('Ocorreu um erro desconhecido ao tentar entrar no grupo.');
      }
    } finally {
      this.isJoiningGroup.set(false);
    }
  }
  
  navigateToGroup(id: string) {
    this.router.navigate(['/groups', id]);
  }

  navigateToGroupsList() {
    this.router.navigate(['/groups']);
  }

  onSubmitAddExpense() {
    if (this.addExpenseForm.valid) {
      this.addExpenseLoading.set(true);
      const expenseData = this.addExpenseForm.getRawValue();
      this.groupService.createExpense({
        description: expenseData.description,
        value: expenseData.value,
        category: expenseData.category,
        groupId: expenseData.groupId
      }).then(() => {
        this.addExpenseLoading.set(false);
        this.closeAddExpenseModal();
      }).catch(error => {
        console.error("Erro ao adicionar despesa:", error);
        alert('Ocorreu um erro ao adicionar a despesa. Tente novamente.');
        this.addExpenseLoading.set(false);
      });
    }
  }

  closeAddExpenseModal() {
    this.addingExpense.set(false);
    this.addExpenseForm.reset();
  }
}