import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

import { Group } from '../../models/group.model';
import { User } from '../../models/user.model';
import { Payment } from '../../models/payment.model';
import { GroupsService } from '../../Services/group/group';
import { AuthService } from '../../Services/auth/auth';
import { UsersService } from '../../Services/user/user';
import { CategoryPieChartComponent } from '../../components/pie-chart/pie-chart';

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CategoryPieChartComponent, MatIconModule],
  templateUrl: './group-detail.html',
})
export class GroupDetail implements OnInit {
  
  // --- Services ---
  private route = inject(ActivatedRoute);
  private groupsService = inject(GroupsService);
  private authService = inject(AuthService);
  private usersService = inject(UsersService);
  private fb = inject(NonNullableFormBuilder);

  // --- State & Cache ---
  private usersCache = new Map<string, User | null>();
  
  group = signal<Group | undefined>(undefined);
  loading = signal<boolean>(true);
  
  // UI State - Modals
  addingExpense = signal<boolean>(false);
  addExpenseLoading = signal<boolean>(false);
  deletingExpense = signal<boolean>(false);
  deletingExpenseId = signal<string | null>(null);
  
  addingPayment = signal<boolean>(false);
  addPaymentLoading = signal<boolean>(false);

  // --- Forms ---
  expenseForm = this.fb.group({
    description: ['', [Validators.required]],
    amount: [0, [Validators.required, Validators.min(0.01)]],
    category: ['', [Validators.required]],
    customCategory: [''],
  });

  paymentForm = this.fb.group({
    value: [0, [Validators.required, Validators.min(0.01)]],
    targetId: ['', [Validators.required]],
  });

  // --- Computed Properties ---

  // Retorna categorias únicas existentes no grupo para autocomplete
  existingCategories = computed(() => {
    const expenses = this.group()?.expenses || [];
    const categories = expenses.map(ex => ex.category.toLowerCase());
    return [...new Set(categories.filter(c => c))];
  });

  totalSpendInCents = computed(() => {
    const expenses = this.group()?.expenses || [];
    return expenses.reduce((sum, expense) => sum + this.toCents(expense.value), 0);
  });

  // Lógica principal de divisão de contas e saldo
  memberBalances = computed(() => {
    const groupData = this.group();
    const totalGroupSpendInCents = this.totalSpendInCents();

    if (!groupData || !groupData.memberIds.length || totalGroupSpendInCents === 0) {
      return { balances: [], creditors: [], debtors: [], currentUserBalance: null };
    }

    // 1. Calcular a parte justa (Fair Share)
    const memberCount = groupData.memberIds.length;
    const baseShareInCents = Math.floor(totalGroupSpendInCents / memberCount);
    let remainderCents = totalGroupSpendInCents % memberCount;

    // 2. Calcular quanto cada membro já pagou
    const totalSpentByMember = new Map<string, number>();
    groupData.memberIds.forEach(id => totalSpentByMember.set(id, 0));

    groupData.expenses?.forEach(expense => {
      const currentSpend = totalSpentByMember.get(expense.payerId) || 0;
      totalSpentByMember.set(expense.payerId, currentSpend + this.toCents(expense.value));
    });

    // 3. Gerar balanços individuais (Pago - Parte Justa)
    const sortedMemberIds = [...groupData.memberIds].sort();
    
    const balancesInCents = sortedMemberIds.map(userId => {
      const totalSpent = totalSpentByMember.get(userId) || 0;
      let memberShare = baseShareInCents;

      // Distribui os centavos restantes para os primeiros da lista (arbitrário mas consistente)
      if (remainderCents > 0) {
        memberShare += 1;
        remainderCents -= 1;
      }

      let balance = totalSpent - memberShare;

      // Ajusta com pagamentos diretos já realizados
      if (groupData.payments) {
        Object.values(groupData.payments).forEach((payment: Payment) => {
          if (payment.payerId === userId) {
            balance += this.toCents(payment.value); // Eu paguei, meu saldo aumenta
          } else if (payment.targetId === userId) {
            balance -= this.toCents(payment.value); // Eu recebi, meu saldo diminui
          }
        });
      }

      return {
        userId,
        name: this.getUserData(userId)?.name || 'Usuário desconhecido',
        balanceInCents: balance
      };
    });

    // 4. Formatar para exibição
    const balances = balancesInCents.map(b => ({
      ...b,
      balance: b.balanceInCents / 100.0
    }));

    return {
      balances,
      creditors: balances.filter(b => b.balance > 0).sort((a, b) => b.balance - a.balance),
      debtors: balances.filter(b => b.balance < 0).sort((a, b) => a.balance - b.balance),
      currentUserBalance: balances.find(b => b.userId === this.authService.currentUser()?.uid) || null
    };
  });

  // Dados para gráficos e relatórios
  categorySpending = computed(() => {
    const expenses = this.group()?.expenses || [];
    const totalSpendCents = this.totalSpendInCents();

    if (totalSpendCents === 0) return [];

    const categoryMap = new Map<string, number>();
    expenses.forEach(expense => {
      const category = expense.category || 'sem categoria';
      const currentTotalCents = categoryMap.get(category) || 0;
      categoryMap.set(category, currentTotalCents + this.toCents(expense.value));
    });

    return Array.from(categoryMap.entries())
      .map(([category, totalCents]) => ({
        category,
        total: totalCents / 100.0,
        percentage: (totalCents / totalSpendCents) * 100
      }))
      .sort((a, b) => b.total - a.total);
  });

  chartDataBreakdown = computed(() => {
    const spending = this.categorySpending();
    if (!spending?.length) return { labels: [], data: [] };
    
    return {
      labels: spending.map(s => s.category),
      data: spending.map(s => s.total)
    };
  });

  // --- Lifecycle ---

  async ngOnInit() {
    this.loading.set(true);
    const groupId = this.route.snapshot.paramMap.get('groupId');

    if (!groupId) {
      console.error('ID do grupo não encontrado na rota!');
      this.loading.set(false);
      return;
    }

    await this.loadGroupData(groupId);
    this.setupExpenseFormListeners();
    this.loading.set(false);
  }

  // --- Actions: Expenses ---

  openAddExpenseModal(): void {
    this.expenseForm.reset({ description: '', amount: 0, category: '', customCategory: '' });
    this.addingExpense.set(true);
  }

  closeAddExpenseModal(): void {
    this.addingExpense.set(false);
  }

  openDeleteExpenseModal(expenseId: string): void {
    this.deletingExpenseId.set(expenseId);
    this.deletingExpense.set(true);
  }

  closeDeleteExpenseModal(): void {
    this.deletingExpenseId.set(null);
    this.deletingExpense.set(false);
  }

  async onSubmitExpense() {
    if (this.expenseForm.invalid) {
      this.expenseForm.markAllAsTouched();
      return;
    }
    
    this.addExpenseLoading.set(true);
    const formValue = this.expenseForm.getRawValue();
    const currentGroupId = this.group()?.id;

    if (!currentGroupId) {
      this.addExpenseLoading.set(false);
      return;
    }

    const finalCategory = (formValue.category === 'new' ? formValue.customCategory : formValue.category).toLowerCase();

    try {
      const newExpense = await this.groupsService.createExpense({
        groupId: currentGroupId,
        description: formValue.description,
        value: formValue.amount,
        category: finalCategory
      });

      // Optimistic Update
      this.group.update(g => g ? { ...g, expenses: [...(g.expenses || []), newExpense] } : g);
      this.closeAddExpenseModal();
    } catch (error) {
      console.error('Erro ao criar despesa', error);
    } finally {
      this.addExpenseLoading.set(false);
    }
  }

  confirmDeleteExpense(): void {
    const expenseId = this.deletingExpenseId();
    if (expenseId) {
      this.deleteExpense(expenseId).then(() => this.closeDeleteExpenseModal());
    }
  }

  async deleteExpense(expenseId: string) {
    const currentGroupId = this.group()?.id;
    if (!currentGroupId) return;

    await this.groupsService.deleteExpense(currentGroupId, expenseId);
    
    this.group.update(g => g ? {
      ...g,
      expenses: g.expenses?.filter(exp => exp.id !== expenseId) || []
    } : g);
  }

  // --- Actions: Payments ---

  openAddPaymentModal(): void {
    this.paymentForm.reset({ value: 0, targetId: '' });
    this.addingPayment.set(true);
  }

  closeAddPaymentModal(): void {
    this.addingPayment.set(false);
  }

  async onSubmitPayment() {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }

    this.addPaymentLoading.set(true);
    const { value, targetId } = this.paymentForm.getRawValue();
    const currentGroupId = this.group()?.id;

    if (!currentGroupId) {
      this.addPaymentLoading.set(false);
      return;
    }

    try {
      const newPayment = await this.groupsService.createPayment({
        groupId: currentGroupId,
        value: value,
        targetId: targetId
      });

      // Normalização de pagamentos (array vs object do Firebase)
      this.group.update(g => {
        if (!g) return g;
        const currentPayments = g.payments ? (Array.isArray(g.payments) ? g.payments : Object.values(g.payments)) : [];
        return { ...g, payments: [...currentPayments, newPayment] } as Group;
      });

      this.closeAddPaymentModal();
    } catch (error) {
      console.error('Erro ao processar pagamento', error);
    } finally {
      this.addPaymentLoading.set(false);
    }
  }

  // --- Helpers & UI Accessors ---

  getAllExpenses(): number {
    return this.totalSpendInCents() / 100.0;
  }

  getAllPayments = (): Payment[] => {
    const g = this.group();
    if (!g?.payments) return [];
    return Array.isArray(g.payments) ? g.payments : Object.values(g.payments);
  };

  expenseName(expenseId: string): string {
    return this.group()?.expenses?.find(exp => exp.id === expenseId)?.description || 'Gasto desconhecido';
  }

  getUserData(userId: string): User | null | undefined {
    return this.usersCache.get(userId);
  }

  getUserId(): string | null {
    return this.authService.currentUser()?.uid || null;
  }

  // --- Private Logic ---

  private async loadGroupData(groupId: string) {
    const groupFromService = await this.groupsService.getGroupByIdAsync(groupId);

    if (groupFromService) {
      // Normalização de dados
      const processedGroup: Group = {
        ...groupFromService,
        expenses: groupFromService.expenses ? Object.values(groupFromService.expenses) : []
      };
      
      // Carregamento de usuários em paralelo
      await Promise.all(processedGroup.memberIds.map(async (id) => {
        if (!this.usersCache.has(id)) {
          const user = await this.usersService.getUserById(id);
          this.usersCache.set(id, user);
        }
      }));
      
      this.group.set(processedGroup);
    }
  }

  private setupExpenseFormListeners(): void {
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

  private toCents(value: number): number {
    return Math.round(value * 100);
  }
}