import { CommonModule } from '@angular/common';
import { Component, computed, Signal, signal, effect, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { GroupsService } from '../../Services/group/group';
import { AuthService } from '../../Services/auth/auth';
import { UsersService } from '../../Services/user/user';
import { AnalyticsService, GeneralAnalysis } from '../../Services/analysis/analytics.service';
import { CategoryPieChartComponent } from '../../components/pie-chart/pie-chart';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule, CategoryPieChartComponent, ReactiveFormsModule], 
  templateUrl: './home.html'
})
export class Home {
  // Serviços
  private groupService = inject(GroupsService);
  private authService = inject(AuthService);
  private usersService = inject(UsersService);
  private analyticsService = inject(AnalyticsService);
  private router = inject(Router);
  private fb = inject(NonNullableFormBuilder);

  // Sinais de Estado UI
  isJoiningGroup = signal(false);
  addingExpense = signal(false);
  addExpenseLoading = signal(false);
  
  // Sinais de Dados
  loading = this.groupService.loading;
  currentUser = this.authService.currentUser;
  groups = this.groupService.groups;
  
  // Sinal para armazenar a análise vinda do Backend
  analysisData = signal<GeneralAnalysis | null>(null);

  private allUsers = signal<User[]>([]);

  // Form de adicionar gasto
  addExpenseForm = this.fb.group({
    description: ['', [Validators.required]],
    value: [0, [Validators.required]],
    category: ['', [Validators.required]],
    groupId: ['', [Validators.required]]
  });

  constructor() {
    // Effect 1: Carregar Grupos ao logar
    effect(() => {
      const user = this.currentUser();   
      if (user && user.uid) {
        (!this.groups()?.length) && !this.groupService.loaded() && this.groupService.loadUserGroups();
      }
    });

    // Effect 2: Carregar Análise Financeira (NOVO)
    effect(async () => {
       const user = this.currentUser();
       const groups = this.groups(); 
       
       if (user && groups) {
         try {
           const analysis = await this.analyticsService.getGeneralAnalysis();
           this.analysisData.set(analysis);
         } catch (err) {
           console.error('Erro ao carregar análise:', err);
         }
       }
    });

    // Effect 3: Carregar detalhes dos usuários (para exibir nomes na lista recente)
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

  // --- Computeds baseados na API ---

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
    const analysis = this.analysisData();
    if (!analysis || !analysis.categorySummary) return { labels: [], data: [] };

    const summary = analysis.categorySummary;
    const labels = Object.keys(summary);
    const data = Object.values(summary);

    return { labels, data };
  });

  // --- Computeds Visuais ---

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
          const expensesList = Object.values(group.expenses);
          if (expensesList.length > 0) {
             lastActivityTime = Math.max(
              0, 
              ...expensesList.map(e => new Date(e.date).getTime())
            );
          }
        }
        return { ...group, lastActivityTime };
      })
      .sort((a, b) => b.lastActivityTime - a.lastActivityTime) 
      .slice(0, 3);
  });

  // --- Ações do Usuário (Modais e Navegação) ---

  openAddExpenseModal() {
    this.addingExpense.set(true);
  }

  async promptToJoinGroup() {
    const groupId = prompt("Digite o ID (código) do grupo que deseja entrar:");
    
    if (!groupId || groupId.trim() === '') return;

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
      }).then(async () => {
        this.addExpenseLoading.set(false);
        this.closeAddExpenseModal();
        
        const analysis = await this.analyticsService.getGeneralAnalysis();
        this.analysisData.set(analysis);

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