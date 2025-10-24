import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Group } from '../../models/group.model';
import { GroupsService } from '../../Services/group/group';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../Services/auth/auth';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { User } from '../../models/user.model';
import { UsersService } from '../../Services/user/user';
import { CategoryPieChartComponent } from '../../components/pie-chart/pie-chart';
import { MatIconModule } from '@angular/material/icon';
import { Payment } from '../../models/payment.model';

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CategoryPieChartComponent, MatIconModule],
  templateUrl: './group-detail.html',
})
export class GroupDetail implements OnInit {
  // --- Injeções de Dependência ---
  private route = inject(ActivatedRoute);
  private groupsService = inject(GroupsService);
  private authService = inject(AuthService);
  private usersService = inject(UsersService);
  private fb = inject(NonNullableFormBuilder);

  // --- Estado (Sinais e Cache) ---
  private usersCache = new Map<string, User | null>();

  group = signal<Group | undefined>(undefined);
  loading = signal<boolean>(true);
  addingExpense = signal<boolean>(false);
  addExpenseLoading = signal<boolean>(false);
  deletingExpense = signal<boolean>(false);
  deletingExpenseId = signal<string | null>(null);
  addingPayment = signal<boolean>(false);
  addPaymentLoading = signal<boolean>(false);

  // --- Definição do Formulário ---
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

  // --- Valores Computados (Computed) ---
  existingCategories = computed(() => {
    const expenses = this.group()?.expenses || [];
    const categories = expenses.map(ex => ex.category.toLowerCase());
    return [...new Set(categories.filter(c => c))];
  });

  totalSpendInCents = computed(() => {
    const expenses = this.group()?.expenses || [];
    // Soma todos os gastos já convertidos para centavos
    return expenses.reduce((sum, expense) => sum + this.toCents(expense.value), 0);
  });

  memberBalances = computed(() => {
    const groupData = this.group();
    const totalGroupSpendInCents = this.totalSpendInCents();

    if (!groupData || !groupData.memberIds.length || totalGroupSpendInCents === 0) {
      return { balances: [], creditors: [], debtors: [], currentUserBalance: null };
    }

    const memberCount = groupData.memberIds.length;
    const baseShareInCents = Math.floor(totalGroupSpendInCents / memberCount);
    let remainderCents = totalGroupSpendInCents % memberCount;

    // Calcula quanto cada um gastou em CENTAVOS
    const totalSpentByMember = new Map<string, number>();
    groupData.memberIds.forEach(id => totalSpentByMember.set(id, 0));

    groupData.expenses?.forEach(expense => {
      const currentSpend = totalSpentByMember.get(expense.payerId) || 0;
      totalSpentByMember.set(expense.payerId, currentSpend + this.toCents(expense.value));
    });

    // Calcula balanços finais, distribuindo o resto
    const sortedMemberIds = [...groupData.memberIds].sort();
    const balancesInCents = sortedMemberIds.map(userId => {
      const totalSpent = totalSpentByMember.get(userId) || 0;

      let memberShare = baseShareInCents;
      if (remainderCents > 0) {
        memberShare += 1;
        remainderCents -= 1;
      }

      let balance = totalSpent - memberShare;
      // Leva em consideração group.payments
      if (groupData.payments) Object.values(groupData.payments).forEach((payment: Payment) => {
        if (payment.payerId === userId) {
          balance += this.toCents(payment.value);
        } else if (payment.targetId === userId) {
          balance -= this.toCents(payment.value);
        }
      });
      return {
        userId,
        name: this.getUserData(userId)?.name || 'Usuário desconhecido',
        balanceInCents: balance
      };
    });

    // Converte de volta para Reais (float) APENAS PARA EXIBIÇÃO
    const balances = balancesInCents.map(b => ({
      ...b,
      balance: b.balanceInCents / 100.0
    }));

    const creditors = balances.filter(b => b.balance > 0).sort((a, b) => b.balance - a.balance);
    const debtors = balances.filter(b => b.balance < 0).sort((a, b) => a.balance - b.balance);

    const currentUserId = this.authService.currentUser()?.uid;
    const currentUserBalance = balances.find(b => b.userId === currentUserId) || null;

    return { balances, creditors, debtors, currentUserBalance };
  });

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

    const spendingArray = Array.from(categoryMap.entries()).map(([category, totalCents]) => ({
      category,
      total: totalCents / 100.0,
      percentage: (totalCents / totalSpendCents) * 100
    }));

    return spendingArray.sort((a, b) => b.total - a.total);
  });

  chartDataBreakdown = computed(() => {
    const spending = this.categorySpending();
    if (!spending || spending.length === 0) {
      return { labels: [], data: [] };
    }
    const labels = spending.map(s => s.category);
    const data = spending.map(s => s.total);
    return { labels, data };
  });

  // --- Lifecycle Hook ---
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

  // --- Métodos Públicos (Usados no Template) ---
  getAllExpenses(): number {
    return this.totalSpendInCents() / 100.0;
  }

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

  openDeleteExpenseModal(expenseId: string): void {
    this.deletingExpenseId.set(expenseId);
    this.deletingExpense.set(true);
  }

  closeDeleteExpenseModal(): void {
    this.deletingExpenseId.set(null);
    this.deletingExpense.set(false);
  }

  confirmDeleteExpense(): void {
    const expenseId = this.deletingExpenseId();
    if (expenseId) {
      this.deleteExpense(expenseId).then(() => {
        this.closeDeleteExpenseModal();
      });
    }
  }

  openAddPaymentModal(): void {
    this.paymentForm.reset({
      value: 0,
      targetId: ''
    });
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
    const formValue = this.paymentForm.getRawValue();
    const currentGroupId = this.group()?.id;
    const currentUserId = this.authService.currentUser()?.uid;

    if (!currentGroupId || !currentUserId) {
      console.error("Faltam dados para criar o pagamento.");
      this.addPaymentLoading.set(false);
      return;
    }
    const newPayment = await this.groupsService.createPayment({
      groupId: currentGroupId,
      value: formValue.value,
      targetId: formValue.targetId
    });
    this.group.update(g => {
      if (!g) return g;
      return {
        ...g,
        payments: [...(g.payments || []), newPayment]
      };
    });
    this.addPaymentLoading.set(false);
    this.closeAddPaymentModal();
  }

  getAllPayments = () => this.group()?.payments?.length ? this.group()!.payments! : this.group()?.payments ? Object.values(this.group()!.payments!) : [] ;

  expenseName(expenseId: string): string {
    const expense = this.group()?.expenses?.find(exp => exp.id === expenseId);
    return expense ? expense.description : 'Gasto desconhecido';
  }

  getUserData(userId: string): User | null | undefined {
    return this.usersCache.get(userId);
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
      console.error("Faltam dados do grupo para criar o gasto.");
      this.addExpenseLoading.set(false);
      return;
    }

    const finalCategory = (formValue.category === 'new' 
      ? formValue.customCategory 
      : formValue.category).toLowerCase();

    const newExpense = await this.groupsService.createExpense({
      groupId: currentGroupId,
      description: formValue.description,
      value: formValue.amount,
      category: finalCategory
    });
    
    this.group.update(g => {
      if (!g) return g;
      return {
        ...g,
        expenses: [...(g.expenses || []), newExpense]
      };
    });
    this.addExpenseLoading.set(false);
    this.closeAddExpenseModal();
  }

  async deleteExpense(expenseId: string) {
    const currentGroupId = this.group()?.id;
    if (!currentGroupId) {
      console.error("ID do grupo não disponível para deletar gasto.");
      return;
    }
    await this.groupsService.deleteExpense(currentGroupId, expenseId);
    this.group.update(g => {
      if (!g) return g;
      return {
        ...g,
        expenses: g.expenses?.filter(exp => exp.id !== expenseId) || []
      };
    });
  }

  getUserId(): string | null {
    return this.authService.currentUser()?.uid || null;
  }

  // --- Métodos Privados (Lógica Interna) ---
  private async loadGroupData(groupId: string) {

    const groupFromService = await this.groupsService.getGroupByIdAsync(groupId);

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