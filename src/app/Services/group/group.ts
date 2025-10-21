import { effect, inject, Injectable, Injector, signal } from '@angular/core';
import { Database, get, ref, set, push } from '@angular/fire/database';
import { Group } from '../../models/group.model';
import { Expense } from '../../models/expense.model';
import { AuthService } from '../auth/auth';
import runInContext from '../../decorators/run-in-context-decorator';

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
        return groups.map(group =>
          group.id === data.groupId
            ? { ...group, expenses: [...(group.expenses || []), newExpense] }
            : group
        );
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