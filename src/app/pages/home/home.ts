import { CommonModule } from '@angular/common';
import { Component, computed, Signal, signal, effect, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { GroupsService } from '../../Services/group/group';
import { AuthService } from '../../Services/auth/auth';
import { UsersService } from '../../Services/user/user';
import { CategoryPieChartComponent } from '../../components/pie-chart/pie-chart';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule, CategoryPieChartComponent], 
  templateUrl: './home.html'
})
export class Home {

  // --- 3. INJEÇÃO DOS SERVIÇOS ---
  loading: Signal<boolean>;
  groups: Signal<Group[] | null>;
  currentUser: Signal<User | null>;
  isJoiningGroup = signal(false);
  
  private allUsers = signal<User[]>([]);

  private groupService = inject(GroupsService);
  private authService = inject(AuthService);
  private usersService = inject(UsersService);
  private router = inject(Router);

  constructor() {
    // --- LIGAÇÃO DOS SINAIS ---
    this.loading = this.groupService.loading;
    this.currentUser = this.authService.currentUser;
    this.groups = this.groupService.groups;

    effect(() => {
      const user = this.currentUser();   
      if (user && user.uid) {
        this.groupService.loadUserGroups();
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
        console.log("0 MEMBROS")
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
    const { totalUserPaid, totalUserShare } = this.financialSummary();
    return Math.max(0, totalUserPaid - totalUserShare);
  });

  userOwes = computed(() => {
    const { totalUserPaid, totalUserShare } = this.financialSummary();
    return Math.max(0, totalUserShare - totalUserPaid);
  });

  netBalance = computed(() => {
    const { totalUserPaid, totalUserShare } = this.financialSummary();
    return totalUserPaid - totalUserShare;
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

    const totals = new Map<string, number>();

    for (const exp of expenses) {
      const cat = exp.category || 'Sem categoria';
      const val = Number(exp.value) || 0;
      totals.set(cat, (totals.get(cat) || 0) + val);
    }

    const labels = Array.from(totals.keys());
    const data = Array.from(totals.values());

    return { labels, data };
  });

  openAddExpenseModal() {
    console.log("Abrir modal de adicionar gasto...");
  }

  async promptToJoinGroup() {
    const groupId = prompt("Digite o ID (código) do grupo que deseja entrar:");
    
    if (!groupId || groupId.trim() === '') {
      return;
    }

    this.isJoiningGroup.set(true);
    try {
      const joinedGroup = await this.groupService.joinGroup(groupId.trim());
      
      alert(`Sucesso! Você agora está no grupo "${joinedGroup.name}".`);
    
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
}