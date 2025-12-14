import { CommonModule } from '@angular/common';
import { Component, computed, Signal, signal, effect, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { AnalyticsService, GeneralAnalysis } from '../../Services/analysis/analysis';
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

  // Injeções
  private groupService = inject(GroupsService);
  private authService = inject(AuthService);
  private usersService = inject(UsersService);
  private analyticsService = inject(AnalyticsService); // Injeção do Analytics
  private router = inject(Router);
  private fb = inject(NonNullableFormBuilder);

  loading = this.groupService.loading;
  currentUser = this.authService.currentUser;
  groups = this.groupService.groups;

  // Novo Sinal para os dados da API de Análise
  analysisData = signal<GeneralAnalysis | null>(null);

  addExpenseForm = this.fb.group({
    description: ['', [Validators.required]],
    value: [0, [Validators.required]],
    category: ['', [Validators.required]],
    groupId: ['', [Validators.required]]
  });

  constructor() {
    // 1. Carregar grupos (Lógica original mantida)
    effect(() => {
      const user = this.currentUser();   
      if (user && user.uid) {
        (!this.groups()?.length) && !this.groupService.loaded() && this.groupService.loadUserGroups();
      }
    });

    // 2. Carregar Análise Financeira (NOVA INTEGRAÇÃO)
    // Busca dados no microsserviço sempre que os grupos mudam
    effect(async () => {
      const user = this.currentUser();
      const groups = this.groups(); // Dependência para recarregar
      
      if (user && groups) {
        try {
          const data = await this.analyticsService.getGeneralAnalysis();
          this.analysisData.set(data);
        } catch (error) {
          console.error('Erro ao carregar análise:', error);
        }
      }
    });

    // 3. Carregar Nomes de Usuários (Lógica original mantida para o feed recente)
    effect(async () => {
      const groups = this.groups();
      if (!groups || groups.length === 0) {
        this.allUsers.set([]);
        return;
      }
      const memberIds = new Set(groups.flatMap(g => g.memberIds ? g.memberIds : []));
      const payerIds = new Set(groups.flatMap(g => g.expenses ? Object.values(g.expenses).map(e => e.payerId) : []));
      const allIds = Array.from(new Set([...memberIds, ...payerIds]));
      
      const usersPromises = allIds.map(id => this.usersService.getUserById(id));
      const users = await Promise.all(usersPromises);
      this.allUsers.set(users.filter(u => u !== null) as User[]);
    });
  }

  // --- Computeds Simplificados (Lendo da API) ---

  netBalance = computed(() => {
    return this.analysisData()?.totalBalance || 0;
  });

  owedToUser = computed(() => {
    return this.analysisData()?.totalOwedToMe || 0;
  });

  userOwes = computed(() => {
    return this.analysisData()?.totalOwedByMe || 0;
  });

  categoryBreakdown = computed(() => {
    const data = this.analysisData();
    if (!data || !data.categorySummary) return { labels: [], data: [] };

    return { 
      labels: Object.keys(data.categorySummary), 
      data: Object.values(data.categorySummary) 
    };
  });

  // --- Lógica Visual (Feed Recente e Grupos Ativos) ---
  // Mantida no front pois depende de data/hora para ordenação visual, não financeiro.

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
        if (group.expenses) {
          const list = Object.values(group.expenses);
          if (list.length > 0) {
             lastActivityTime = Math.max(0, ...list.map(e => new Date(e.date).getTime()));
          }
        }
        return { ...group, lastActivityTime };
      })
      .sort((a, b) => b.lastActivityTime - a.lastActivityTime) 
      .slice(0, 3);
  });

  // --- Métodos de Ação (Mantidos iguais) ---

  openAddExpenseModal() { this.addingExpense.set(true); }
  closeAddExpenseModal() { this.addingExpense.set(false); this.addExpenseForm.reset(); }
  navigateToGroup(id: string) { this.router.navigate(['/groups', id]); }
  navigateToGroupsList() { this.router.navigate(['/groups']); }

  async promptToJoinGroup() {
    const groupId = prompt("Digite o ID (código) do grupo que deseja entrar:");
    if (!groupId?.trim()) return;

    this.isJoiningGroup.set(true);
    try {
      await this.groupService.joinGroup(groupId.trim());
      alert(`Sucesso! Você agora está no grupo!`);
    } catch (error: any) {
      console.error("Erro ao entrar no grupo:", error);
      alert(error.message.includes('Grupo não encontrado') ? 'Grupo não encontrado.' : 'Erro desconhecido.');
    } finally {
      this.isJoiningGroup.set(false);
    }
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
      }).then(async () => {
        this.addExpenseLoading.set(false);
        this.closeAddExpenseModal();
        // Atualizar análise
        const data = await this.analyticsService.getGeneralAnalysis();
        this.analysisData.set(data);
      }).catch(error => {
        console.error("Erro ao adicionar despesa:", error);
        alert('Ocorreu um erro ao adicionar a despesa.');
        this.addExpenseLoading.set(false);
      });
    }
  }
}