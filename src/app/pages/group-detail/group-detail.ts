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
import { CategoryPieChartComponent } from '../../components/pie-chart/pie-chart';

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CategoryPieChartComponent],
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

  private toCents(value: number): number {
    return Math.round(value * 100);
  }

  totalSpendInCents = computed(() => {
    const expenses = this.group()?.expenses || [];
    // Soma todos os gastos já convertidos para centavos
    return expenses.reduce((sum, expense) => sum + this.toCents(expense.value), 0);
  });

  memberBalances = computed(() => {
    const groupData = this.group();
    const totalGroupSpendInCents = this.totalSpendInCents(); // Usa o novo computed

    if (!groupData || !groupData.memberIds.length || totalGroupSpendInCents === 0) {
      return { balances: [], creditors: [], debtors: [], currentUserBalance: null };
    }

    const memberCount = groupData.memberIds.length;

    // 2. Calcula a cota base e o "resto" (centavos indivisíveis)
    const baseShareInCents = Math.floor(totalGroupSpendInCents / memberCount);
    let remainderCents = totalGroupSpendInCents % memberCount;

    // 3. Calcula quanto cada um gastou em CENTAVOS
    const totalSpentByMember = new Map<string, number>();
    groupData.memberIds.forEach(id => totalSpentByMember.set(id, 0));

    groupData.expenses?.forEach(expense => {
      const currentSpend = totalSpentByMember.get(expense.payerId) || 0;
      totalSpentByMember.set(expense.payerId, currentSpend + this.toCents(expense.value));
    });

    // 4. Calcula balanços finais, distribuindo o resto
    // Ordenamos os IDs para que a distribuição do resto seja sempre consistente
    const sortedMemberIds = [...groupData.memberIds].sort();

    const balancesInCents = sortedMemberIds.map(userId => {
      const totalSpent = totalSpentByMember.get(userId) || 0;

      // Distribui o resto: os primeiros 'remainderCents' membros na lista pagam 1 centavo a mais
      let memberShare = baseShareInCents;
      if (remainderCents > 0) {
        memberShare += 1;
        remainderCents -= 1;
      }

      const balance = totalSpent - memberShare;
      return {
        userId,
        name: this.getUserData(userId)?.name || 'Usuário desconhecido',
        balanceInCents: balance // Mantemos em centavos
      };
    });

    // 5. Converte de volta para Reais (float) APENAS PARA EXIBIÇÃO
    const balances = balancesInCents.map(b => ({
      ...b,
      balance: b.balanceInCents / 100.0 // Converte para float
    }));

    const creditors = balances.filter(b => b.balance > 0).sort((a, b) => b.balance - a.balance);
    const debtors = balances.filter(b => b.balance < 0).sort((a, b) => a.balance - b.balance);

    const currentUserId = this.authService.currentUser()?.uid;
    const currentUserBalance = balances.find(b => b.userId === currentUserId) || null;

    return { balances, creditors, debtors, currentUserBalance };
  });

  /**
   * Agrega os gastos totais por categoria USANDO CENTAVOS.
   */
  categorySpending = computed(() => {
    const expenses = this.group()?.expenses || [];
    const totalSpendCents = this.totalSpendInCents(); // Usa o novo computed

    if (totalSpendCents === 0) return [];

    const categoryMap = new Map<string, number>();
    expenses.forEach(expense => {
      const category = expense.category || 'sem categoria';
      const currentTotalCents = categoryMap.get(category) || 0;
      // Soma em centavos
      categoryMap.set(category, currentTotalCents + this.toCents(expense.value));
    });

    const spendingArray = Array.from(categoryMap.entries()).map(([category, totalCents]) => ({
      category,
      total: totalCents / 100.0, // Converte para float para exibição
      percentage: (totalCents / totalSpendCents) * 100
    }));

    return spendingArray.sort((a, b) => b.total - a.total);
  });

  chartDataBreakdown = computed(() => {
    const spending = this.categorySpending(); // Seu signal existente

    if (!spending || spending.length === 0) {
      return { labels: [], data: [] };
    }

    // Transforma o array de objetos em dois arrays separados
    const labels = spending.map(s => s.category);
    const data = spending.map(s => s.total); // Usa o valor 'total' em R$

    return { labels, data };
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
    return this.totalSpendInCents() / 100.0;
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

  async deleteExpense(expenseId: string) {
    const currentGroupId = this.group()?.id;
    if (!currentGroupId) {
      console.error("ID do grupo não disponível para deletar gasto.");
      return;
    }
    await this.groupsService.deleteExpense(currentGroupId, expenseId);
    this.group.update(g => {
      if (g) {
        g.expenses = g.expenses?.filter(exp => exp.id !== expenseId) || [];
      }
      return g;
    });
  }

  getUserId(): string | null {
    return this.authService.currentUser()?.uid || null;
  }
}