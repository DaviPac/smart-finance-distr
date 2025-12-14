import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

// Models e Services
import { Group } from '../../models/group.model';
import { User } from '../../models/user.model';
import { GroupsService } from '../../Services/group/group';
import { AuthService } from '../../Services/auth/auth';
import { UsersService } from '../../Services/user/user';
// Importação do novo Service
import { AnalyticsService, GroupAnalysis } from '../../Services/analysis/analytics.service';

import { CategoryPieChartComponent } from '../../components/pie-chart/pie-chart';
import { Payment } from '../../models/payment.model';
import { Expense } from '../../models/expense.model';

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CategoryPieChartComponent, MatIconModule],
  templateUrl: './group-detail.html',
})
export class GroupDetail implements OnInit {
  
  // --- Injeções ---
  private route = inject(ActivatedRoute);
  private groupsService = inject(GroupsService);
  private authService = inject(AuthService);
  private usersService = inject(UsersService);
  private analyticsService = inject(AnalyticsService); // <--- Injeção do Analytics
  private fb = inject(NonNullableFormBuilder);

  // --- Estado ---
  private usersCache = new Map<string, User | null>();
  
  // Dados principais
  group = signal<Group | undefined>(undefined);
  analysis = signal<GroupAnalysis | null>(null); // <--- Dados vindos do microsserviço
  
  loading = signal<boolean>(true);
  
  // Controle de UI (Modais)
  addingExpense = signal<boolean>(false);
  addExpenseLoading = signal<boolean>(false);
  deletingExpense = signal<boolean>(false);
  deletingExpenseId = signal<string | null>(null);
  addingPayment = signal<boolean>(false);
  addPaymentLoading = signal<boolean>(false);

  // --- Formulários ---
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

  // --- Computed Properties (Baseados na API) ---

  // Categorias existentes (para autocomplete) - Mantido local pois é simples
  existingCategories = computed(() => {
    const expenses = this.group()?.expenses || [];
    const categories = expenses.map(ex => ex.category.toLowerCase());
    return [...new Set(categories.filter(c => c))];
  });

  // Total gasto (Vem direto do backend agora)
  totalSpend = computed(() => {
    return this.analysis()?.totalSpent || 0;
  });

  // Meu Saldo Líquido (Vem direto do backend)
  myBalance = computed(() => {
    return this.analysis()?.myBalance || 0;
  });

  // Quem deve a mim (Calculado pelo algoritmo Greedy do Backend)
  owedToMe = computed(() => {
    const data = this.analysis();
    if (!data || !data.owedBy) return [];
    
    return data.owedBy.map(debt => ({
      userId: debt.userId,
      name: this.getUserData(debt.userId)?.name || 'Desconhecido',
      amount: debt.amount
    }));
  });

  // A quem eu devo (Calculado pelo algoritmo Greedy do Backend)
  iOweTo = computed(() => {
    const data = this.analysis();
    if (!data || !data.oweTo) return [];

    return data.oweTo.map(debt => ({
      userId: debt.userId,
      name: this.getUserData(debt.userId)?.name || 'Desconhecido',
      amount: debt.amount
    }));
  });

  // Breakdown de Categorias (Vem pronto do backend)
  chartDataBreakdown = computed(() => {
    const summary = this.analysis()?.categorySummary;
    if (!summary) return { labels: [], data: [] };

    return {
      labels: Object.keys(summary),
      data: Object.values(summary)
    };
  });

  // Lista formatada para exibição de lista (opcional)
  categoryList = computed(() => {
    const summary = this.analysis()?.categorySummary;
    if (!summary) return [];
    const total = this.totalSpend();

    return Object.entries(summary)
      .map(([cat, val]) => ({
        category: cat,
        total: val,
        percentage: total > 0 ? (val / total) * 100 : 0
      }))
      .sort((a, b) => b.total - a.total);
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

    // Carrega dados iniciais
    await this.refreshAllData(groupId);
    this.setupExpenseFormListeners();
    this.loading.set(false);
  }

  // --- Método Central de Carregamento ---

  private async refreshAllData(groupId: string) {
    // 1. Carrega detalhes do grupo (Firebase)
    // Precisamos disso para ter a lista de membros e nomes
    const groupFromService = await this.groupsService.getGroupByIdAsync(groupId);

    if (groupFromService) {
      const processedGroup: Group = {
        ...groupFromService,
        expenses: groupFromService.expenses ? Object.values(groupFromService.expenses) : []
      };
      
      // Cache de Usuários (para exibir nomes nas dívidas)
      await Promise.all(processedGroup.memberIds.map(async (id) => {
        if (!this.usersCache.has(id)) {
          const user = await this.usersService.getUserById(id);
          this.usersCache.set(id, user);
        }
      }));
      
      this.group.set(processedGroup);

      // 2. Carrega Análise Financeira (Microsserviço Go)
      try {
        const analysisData = await this.analyticsService.getGroupAnalysis(groupId);
        this.analysis.set(analysisData);
      } catch (error) {
        console.error('Erro ao carregar análise do grupo:', error);
      }
    }
  }

  // --- Actions: Expenses ---

  openAddExpenseModal() {
    this.expenseForm.reset({ description: '', amount: 0, category: '', customCategory: '' });
    this.addingExpense.set(true);
  }

  closeAddExpenseModal() {
    this.addingExpense.set(false);
  }

  async onSubmitExpense() {
    if (this.expenseForm.invalid) {
      this.expenseForm.markAllAsTouched();
      return;
    }
    
    this.addExpenseLoading.set(true);
    const formValue = this.expenseForm.getRawValue();
    const currentGroupId = this.group()?.id;

    if (!currentGroupId) return;

    const finalCategory = (formValue.category === 'new' ? formValue.customCategory : formValue.category).toLowerCase();

    try {
      await this.groupsService.createExpense({
        groupId: currentGroupId,
        description: formValue.description,
        value: formValue.amount,
        category: finalCategory
      });
      
      this.closeAddExpenseModal();
      // Recarrega tudo para pegar a nova análise atualizada do backend
      await this.refreshAllData(currentGroupId);

    } catch (error) {
      console.error('Erro ao criar despesa', error);
    } finally {
      this.addExpenseLoading.set(false);
    }
  }

  openDeleteExpenseModal(expenseId: string) {
    this.deletingExpenseId.set(expenseId);
    this.deletingExpense.set(true);
  }

  closeDeleteExpenseModal() {
    this.deletingExpenseId.set(null);
    this.deletingExpense.set(false);
  }

  confirmDeleteExpense() {
    const expenseId = this.deletingExpenseId();
    const groupId = this.group()?.id;
    
    if (expenseId && groupId) {
      this.groupsService.deleteExpense(groupId, expenseId).then(() => {
        this.closeDeleteExpenseModal();
        this.refreshAllData(groupId); // Atualiza análise
      });
    }
  }

  // --- Actions: Payments ---

  openAddPaymentModal() {
    this.paymentForm.reset({ value: 0, targetId: '' });
    this.addingPayment.set(true);
  }

  closeAddPaymentModal() {
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

    if (!currentGroupId) return;

    try {
      await this.groupsService.createPayment({
        groupId: currentGroupId,
        value: value,
        targetId: targetId
      });

      this.closeAddPaymentModal();
      await this.refreshAllData(currentGroupId); // Atualiza análise (recalcula dívidas)
    } catch (error) {
      console.error('Erro ao processar pagamento', error);
    } finally {
      this.addPaymentLoading.set(false);
    }
  }

  // --- Helpers ---

  getAllExpenses(): Expense[] {
    // Normalização para lista, caso precise iterar no template
    const g = this.group();
    if (!g?.expenses) return [];
    return Array.isArray(g.expenses) ? g.expenses : Object.values(g.expenses);
  }

  getAllPayments(): Payment[] {
    const g = this.group();
    if (!g?.payments) return [];
    return Array.isArray(g.payments) ? g.payments : Object.values(g.payments);
  }

  expenseName(expenseId: string): string {
    return this.getAllExpenses().find(exp => exp.id === expenseId)?.description || 'Desconhecido';
  }

  getUserData(userId: string): User | null | undefined {
    return this.usersCache.get(userId);
  }

  getUserId(): string | null {
    return this.authService.currentUser()?.uid || null;
  }

  private setupExpenseFormListeners() {
    this.expenseForm.get('category')?.valueChanges.subscribe(value => {
      const customCtrl = this.expenseForm.get('customCategory');
      if (value === 'new') {
        customCtrl?.setValidators([Validators.required]);
      } else {
        customCtrl?.clearValidators();
      }
      customCtrl?.updateValueAndValidity();
    });
  }
}