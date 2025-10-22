import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Group } from '../../models/group.model';
import { GroupsService } from '../../Services/group/group';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../Services/auth/auth';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Expense } from '../../models/expense.model';
import { User } from '../../models/user.model';
import { UsersService } from '../../Services/user/user';

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './group-detail.html',
})
export class GroupDetail implements OnInit {
  private route = inject(ActivatedRoute);
  private groupsService = inject(GroupsService);
  private authService = inject(AuthService);
  private usersService = inject(UsersService);
  private fb = inject(NonNullableFormBuilder);

  private usersCache = new Map<string, User | null>();

  group = signal<Group | undefined>(undefined);
  expenses = signal<Expense[]>([]);
  loading = signal<boolean>(true);
  addingExpense = signal<boolean>(false);
  addExpenseLoading = signal<boolean>(false);

  existingCategories = computed(() => {
    const expenses = this.group()?.expenses || [];
    const categories = expenses.map(ex => ex.category.toLowerCase());
    return [...new Set(categories.filter(c => c))];
  });

  expenseForm = this.fb.group({
    description: ['', [Validators.required]],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    category: ['', [Validators.required]],
    customCategory: [''],
  });

  memberBalances = computed(() => {
    const groupData = this.group();
    if (!groupData || !groupData.memberIds.length) {
      return { balances: [], creditors: [], debtors: [], currentUserBalance: null };
    }

    const totalGroupSpend = this.getAllExpenses();
    const memberCount = groupData.memberIds.length;
    const averageSpendPerMember = totalGroupSpend / memberCount;

    // 1. Calcula quanto cada um gastou
    const totalSpentByMember = new Map<string, number>();
    groupData.memberIds.forEach(id => totalSpentByMember.set(id, 0)); // Inicializa todos com 0

    groupData.expenses?.forEach(expense => {
      const currentSpend = totalSpentByMember.get(expense.payerId) || 0;
      totalSpentByMember.set(expense.payerId, currentSpend + expense.value);
    });

    // 2. Calcula o balanço (gasto - média)
    const balances = groupData.memberIds.map(userId => {
      const totalSpent = totalSpentByMember.get(userId) || 0;
      const balance = totalSpent - averageSpendPerMember;
      return {
        userId,
        name: this.getUserData(userId)?.name || 'Usuário desconhecido',
        balance: balance
      };
    });

    // 3. Separa credores (quem recebe) e devedores (quem paga)
    const creditors = balances.filter(b => b.balance > 0).sort((a, b) => b.balance - a.balance);
    const debtors = balances.filter(b => b.balance < 0).sort((a, b) => a.balance - b.balance);
    
    // 4. Encontra o balanço do usuário logado
    const currentUserId = this.authService.currentUser()?.uid;
    const currentUserBalance = balances.find(b => b.userId === currentUserId) || null;

    return { balances, creditors, debtors, currentUserBalance };
  });

  categorySpending = computed(() => {
    const expenses = this.group()?.expenses || [];
    const totalSpend = this.getAllExpenses();
    
    if (totalSpend === 0) return [];

    const categoryMap = new Map<string, number>();
    expenses.forEach(expense => {
      const category = expense.category || 'sem categoria';
      const currentTotal = categoryMap.get(category) || 0;
      categoryMap.set(category, currentTotal + expense.value);
    });

    const spendingArray = Array.from(categoryMap.entries()).map(([category, total]) => ({
      category,
      total,
      percentage: (total / totalSpend) * 100
    }));

    return spendingArray.sort((a, b) => b.total - a.total); // Ordena do maior para o menor
  });

  async ngOnInit() {
    this.loading.set(true);
    const groupId = this.route.snapshot.paramMap.get('groupId');

    if (!groupId) {
      console.error('ID do grupo não encontrado na rota!');
      this.loading.set(false);
      return;
    }

    const groupFromService = this.groupsService.getGroupById(groupId);

    if (groupFromService) {
      const processedGroup: Group = {
        ...groupFromService,
        memberIds: Object.keys(groupFromService.memberIds),
        expenses: groupFromService.expenses ? Object.values(groupFromService.expenses) : []
      };
      
      const userFetchPromises = processedGroup.memberIds.map(async (id) => {
        const user = await this.usersService.getUserById(id);
        this.usersCache.set(id, user);
      });
      
      await Promise.all(userFetchPromises);

      this.group.set(processedGroup);

    } else {
      console.log('Grupo não encontrado!');
    }
    
    this.loading.set(false);

    this.expenseForm.get('category')?.valueChanges.subscribe(value => {
      const customCategoryControl = this.expenseForm.get('customCategory');
      if (value === 'new') {
        customCategoryControl?.setValidators([Validators.required]);
      } else {
        customCategoryControl?.clearValidators();
      }
      customCategoryControl?.updateValueAndValidity();
    });

  }

  getAllExpenses(): number {
    let expenses = 0;
    this.group()?.expenses?.forEach(ex => expenses += ex.value);
    return expenses;
  }

  // --- Modal Control ---
  openAddExpenseModal(): void {
    this.expenseForm.reset({
      description: '',
      amount: 0,
      category: '',
      customCategory: ''
    });
    this.addingExpense.set(true);
  }

  closeAddExpenseModal(): void {
    this.addingExpense.set(false);
  }

  getUserData(userId: string): User | null | undefined {
    return this.usersCache.get(userId);
  }

  // --- Form Submission ---
  async onSubmitExpense() {
    // NOVO: Marcar campos como "tocados" para exibir erros
    if (this.expenseForm.invalid) {
        this.expenseForm.markAllAsTouched();
        return;
    }
    
    this.addExpenseLoading.set(true);
    const formValue = this.expenseForm.getRawValue();
    const currentGroupId = this.group()?.id;
    const currentUserId = this.authService.currentUser()?.email;

    if (!currentGroupId || !currentUserId) {
      console.error("Faltam dados do grupo ou do usuário para criar o gasto.");
      this.addExpenseLoading.set(false);
      return;
    }

    // NOVO: Determinar a categoria final
    const finalCategory = (formValue.category === 'new' 
      ? formValue.customCategory 
      : formValue.category).toLowerCase(); // Padroniza para minúsculas

    const newExpense = await this.groupsService.createExpense({
      groupId: currentGroupId,
      description: formValue.description,
      value: formValue.amount,
      category: finalCategory // NOVO: Usar a categoria final
    });
    
    this.group.update(g => {
      g?.expenses?.push(newExpense);
      return g;
    });
    this.addExpenseLoading.set(false);
    this.closeAddExpenseModal();
  }
}