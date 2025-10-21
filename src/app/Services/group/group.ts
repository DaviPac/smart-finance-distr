import { effect, inject, Injectable, Injector, signal } from '@angular/core';
import { Database, get, ref, set, push } from '@angular/fire/database';
import { Group } from '../../models/group.model';
import { Expense } from '../../models/expense.model';
import { AuthService } from '../auth/auth';
import runInContext from '../../decorators/run-in-context-decorator';
import { update } from 'firebase/database';

@Injectable({
  providedIn: 'root'
})
export class GroupsService {

  //- Injeção de Dependências
  private db: Database = inject(Database);
  private authService: AuthService = inject(AuthService);
  injector = inject(Injector);

  //- Gerenciamento de Estado
  private readonly _groups = signal<Group[] | null>(null);
  public readonly groups = this._groups.asReadonly();
  public readonly loading = signal<boolean>(false);
  public currentGroup = signal<Group | null>(null);

  constructor() {
    // Efeito que reage às mudanças no estado de autenticação
    effect(() => {
      if (!this.authService.currentUser()) {
        console.log('Usuário deslogou. Resetando o estado de GroupsService.');
        this.reset();
      }
    });
  }

  reset() {
    this._groups.set(null);
  }

  //- Métodos Públicos
  @runInContext()
  async loadUserGroups(): Promise<void> {
    const user = this.authService.currentUser();
    const currentUid = user?.uid;

    if (!currentUid) {
      this._groups.set([]);
      return;
    }

    this.loading.set(true);

    try {
      const userGroupsRef = ref(this.db, `user_groups/${currentUid}`);
      const userGroupsSnapshot = await get(userGroupsRef);

      if (!userGroupsSnapshot.exists()) {
        this._groups.set([]);
        return;
      }

      const groupIds = Object.keys(userGroupsSnapshot.val() as { [groupId: string]: boolean });
      if (groupIds.length === 0) {
        this._groups.set([]);
        return;
      }

      const groupDetailPromises = groupIds.map(groupId => this._getGroupDetails(groupId));
      const groups = (await Promise.all(groupDetailPromises)).filter((g): g is Group => g !== null);
      
      this._groups.set(groups);
    } catch (error) {
      console.error("Erro ao buscar grupos para o usuário:", error);
      this._groups.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  @runInContext()
  async createGroup(groupName: string, description: string = 'Sem descrição'): Promise<Group> {
    const ownerId = this.authService.currentUser()?.uid;
    if (!ownerId) {
      throw new Error('Nenhum usuário autenticado para criar um grupo.');
    }

    const newGroupRef = push(ref(this.db, 'groups'));
    const newGroupId = newGroupRef.key;
    if (!newGroupId) {
      throw new Error('Falha ao gerar um ID único para o grupo.');
    }

    const groupData = {
      name: groupName,
      description: description,
      ownerId: ownerId,
      memberIds: { [ownerId]: true },
      createdAt: new Date().toISOString()
    };

    try {
      await set(ref(this.db, `groups/${newGroupId}`), groupData);
      await set(ref(this.db, `user_groups/${ownerId}/${newGroupId}`), true);

      const newGroup: Group = {
        id: newGroupId,
        ...groupData,
        memberIds: [ownerId] 
      };

      this._groups.update(currentGroups => [...(currentGroups || []), newGroup]);
      return newGroup;
    } catch (error) {
      console.error(`Erro ao criar o grupo "${groupName}":`, error);
      throw error;
    }
  }

  @runInContext()
  async joinGroup(groupId: string): Promise<Group> {
    const userId = this.authService.currentUser()?.uid;
    if (!userId) {
      throw new Error('Nenhum usuário autenticado para entrar em um grupo.');
    }

    const groupRef = ref(this.db, `groups/${groupId}`);

    try {
      // 1. Verificar se o grupo existe
      const groupSnapshot = await get(groupRef);
      if (!groupSnapshot.exists()) {
        throw new Error('Grupo não encontrado.');
      }

      const groupDataFromDb = groupSnapshot.val();

      // 2. Verificar se o usuário já é membro (usando a estrutura de objeto)
      if (groupDataFromDb.memberIds && groupDataFromDb.memberIds[userId]) {
        console.warn('Usuário já é membro deste grupo.');
        // Se já for membro, apenas retorne os dados locais (convertendo memberIds para array)
        return {
          id: groupId,
          ...groupDataFromDb,
          memberIds: Object.keys(groupDataFromDb.memberIds)
        };
      }

      // 3. Preparar a atualização atômica para as duas localizações no DB
      const updates: { [key: string]: any } = {};
      updates[`groups/${groupId}/memberIds/${userId}`] = true; // Adiciona usuário ao grupo
      updates[`user_groups/${userId}/${groupId}`] = true;      // Adiciona grupo ao usuário

      await update(ref(this.db), updates);

      // 4. Preparar o objeto local para o sinal
      // (Seguindo seu padrão de `createGroup`, convertemos o objeto memberIds em um array)
      const updatedMemberIds = groupDataFromDb.memberIds ? [...Object.keys(groupDataFromDb.memberIds), userId] : [userId];

      const joinedGroup: Group = {
        id: groupId,
        ...groupDataFromDb,
        memberIds: updatedMemberIds // Armazena como array localmente
      };

      // 5. Atualizar o sinal local para incluir este novo grupo
      this._groups.update(currentGroups => [...(currentGroups || []), joinedGroup]);
      
      return joinedGroup;

    } catch (error) {
      console.error(`Erro ao tentar entrar no grupo "${groupId}":`, error);
      throw error;
    }
  }

  @runInContext()
  async createExpense(data: Omit<Expense, 'id' | 'date' | 'payerId'>): Promise<Expense> {
    const payerId = this.authService.currentUser()?.uid;
    if (!payerId) {
      throw new Error('Nenhum usuário autenticado para criar uma despesa.');
    }
    if (!data.groupId) {
      throw new Error('O groupId é necessário para criar uma despesa.');
    }

    const newExpenseRef = push(ref(this.db, `groups/${data.groupId}/expenses`));
    const newExpenseId = newExpenseRef.key;
    if (!newExpenseId) {
      throw new Error('Falha ao gerar um ID único para a despesa.');
    }

    const newExpense: Expense = {
      id: newExpenseId,
      ...data,
      payerId: payerId,
      date: new Date()
    };

    try {
      await set(newExpenseRef, newExpense);

      this._groups.update(groups => {
        if (!groups) return [];
        
        return groups.map(group => {
          // Encontra o grupo correto
          if (group.id === data.groupId) {
            
            // --- CORREÇÃO AQUI ---

            // 1. Converte o objeto 'expenses' atual em um array.
            //    Usa '|| {}' para garantir que funcione se group.expenses for null/undefined.
            const expensesArray = Object.values(group.expenses || {});

            // 2. Cria o novo array de despesas, espalhando o array antigo e adicionando a nova.
            const updatedExpensesArray = [...expensesArray, newExpense];

            // 3. Retorna o grupo atualizado.
            //    'expenses' agora é um array, o que deve satisfazer seu tipo 'Group'.
            return { ...group, expenses: updatedExpensesArray };
            
          } else {
            // Retorna os outros grupos sem modificação
            return group;
          }
        });
      });

      return newExpense;
    } catch (error) {
      console.error(`Erro ao criar despesa no grupo ${data.groupId}:`, error);
      throw error;
    }
  }

  getGroupById(id: string): Group | undefined {
    return this.groups()?.find(g => g.id === id);
  }

  //- Métodos Privados
  @runInContext()
  private async _getGroupDetails(groupId: string): Promise<Group | null> {
    try {
      const groupRef = ref(this.db, `groups/${groupId}`);
      const groupSnapshot = await get(groupRef);

      if (groupSnapshot.exists()) {
        return { id: groupId, ...groupSnapshot.val() } as Group;
      }
      return null;
    } catch (error) {
      console.error(`Falha ao buscar detalhes do grupo ${groupId}`, error);
      return null;
    }
  }
}