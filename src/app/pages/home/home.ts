import { CommonModule } from '@angular/common';
import { Component, computed, Signal, signal, effect, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { User } from '../../models/user.model';
import { Group } from '../../models/group.model';
import { GroupsService } from '../../Services/group/group';
import { AuthService } from '../../Services/auth/auth';
import { UsersService } from '../../Services/user/user';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule], 
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

    // --- 4. EFEITO PARA BUSCAR USUÁRIOS ---
    effect(async () => {
      const groups = this.groups();
      if (!groups || groups.length === 0) {
        this.allUsers.set([]);
        return;
      }

      // 1. Coleta todos os IDs únicos
      const memberIds = new Set(groups.flatMap(g => g.memberIds ? Object.keys(g.memberIds) : []));
      
      // <-- MUDANÇA AQUI: Usamos Object.values() para transformar o objeto em array
      const payerIds = new Set(groups.flatMap(g => g.expenses ? Object.values(g.expenses).map(e => e.payerId) : []));
      
      const allIds = Array.from(new Set([...memberIds, ...payerIds]));

      // 2. Busca todos os usuários
      const usersPromises = allIds.map(id => this.usersService.getUserById(id));
      const users = await Promise.all(usersPromises);

      // 3. Filtra nulos e atualiza o sinal
      this.allUsers.set(users.filter(u => u !== null) as User[]);
    });
  }
  
  // --- 1. SINAL COMPUTADO: Todas as Despesas ---
  private allExpenses = computed(() => {
    const usersMap = new Map(this.allUsers().map(u => [u.uid, u.name]));
    
    return this.groups()?.flatMap(group => 
      // <-- MUDANÇA AQUI: Usamos Object.values() para transformar o objeto em array
      group.expenses ? Object.values(group.expenses).map(expense => ({
        ...expense,
        groupName: group.name,
        payerName: usersMap.get(expense.payerId) || 'Usuário Desconhecido'
      })) : []
    );
  });

  // --- 2. SINAL COMPUTADO: Resumo Financeiro ---
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
            // --- CORREÇÃO AQUI ---
            // Garante que o valor seja um número e não NaN.
            // Se expense.value for undefined ou null, será 0.
            const expenseValue = Number(expense.value) || 0; 
            // --- FIM DA CORREÇÃO ---

            const share = expenseValue / numMembers;
            totalUserShare += share;
            
            if (expense.payerId === myId) {
              totalUserPaid += expenseValue; // Usa a variável segura
            }
        }
      }
    }
    
    return { totalUserPaid, totalUserShare };
  });

  // --- 3. SINAIS PÚBLICOS (para o Template) ---
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
        // <-- MUDANÇA AQUI: Usamos Object.keys() para checar se o objeto tem itens
        if (group.expenses && Object.keys(group.expenses).length > 0) {
          lastActivityTime = Math.max(
            0, 
            // <-- MUDANÇA AQUI: Usamos Object.values() para transformar o objeto em array
            ...Object.values(group.expenses).map(e => new Date(e.date).getTime())
          );
        }
        return { ...group, lastActivityTime };
      })
      .sort((a, b) => b.lastActivityTime - a.lastActivityTime) 
      .slice(0, 3);
  });

  // --- 5. FUNÇÕES LIGADAS ---
  openAddExpenseModal() {
    console.log("Abrir modal de adicionar gasto...");
  }

  async promptToJoinGroup() {
    const groupId = prompt("Digite o ID (código) do grupo que deseja entrar:");
    
    if (!groupId || groupId.trim() === '') {
      return; // Usuário cancelou ou não digitou nada
    }

    this.isJoiningGroup.set(true);
    try {
      // Usamos o método do serviço que criamos anteriormente
      const joinedGroup = await this.groupService.joinGroup(groupId.trim());
      
      // O `joinGroup` já é inteligente e retorna o grupo mesmo se
      // o usuário já for membro. Um alerta de sucesso funciona nos dois casos.
      alert(`Sucesso! Você agora está no grupo "${joinedGroup.name}".`);
      
      // O sinal `this.groups` no serviço será atualizado,
      // e o dashboard (incluindo "activeGroups") irá reagir.
    
    } catch (error: any) {
      console.error("Erro ao entrar no grupo:", error);
      // Trata os erros mais comuns
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