import { effect, inject, Injectable, Injector, signal } from '@angular/core';
import { Group } from '../../models/group.model';
import { Expense } from '../../models/expense.model';
import { AuthService } from '../auth/auth';
import { Payment } from '../../models/payment.model';
import runInContext from '../../decorators/run-in-context-decorator';

@Injectable({
  providedIn: 'root'
})
export class GroupsService {

  private authService: AuthService = inject(AuthService);
  injector = inject(Injector);

  private readonly _groups = signal<Group[] | null>(null);
  public readonly groups = this._groups.asReadonly();
  public readonly loading = signal<boolean>(false);
  public readonly loaded = signal<boolean>(false);
  public currentGroup = signal<Group | null>(null);

  constructor() {
    effect(() => {
      if (!this.authService.currentUser()) {
        this.reset();
      }
    });
  }

  reset() {
    this._groups.set(null);
  }

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
      const resp = await fetch("https://smart-finance-groups-production.up.railway.app/api/groups", {
        headers: {
          "Authorization": "Bearer " + this.authService.token
        }
      })
      if (!resp.ok) throw new Error("erro ao buscar grupos")
      const groups: Group[] = await resp.json()
      groups.forEach(g => {
        if (g.memberIds) {
          g.memberIds = Object.keys(g.memberIds)
        }
        if (g.expenses) {
          g.expenses = Object.values(g.expenses)
          g.expenses.forEach(e => e.date = new Date(e.date))
        }
      })
      
      this._groups.set(groups);
    } catch (error) {
      console.error("Erro ao buscar grupos para o usuário:", error);
      this._groups.set([]);
    } finally {
      this.loading.set(false);
      this.loaded.set(true)
    }
  }

  @runInContext()
  async createGroup(groupName: string, description: string = 'Sem descrição'): Promise<Group> {
    const resp = await fetch("https://smart-finance-groups-production.up.railway.app/api/group", {
      method: "POST",
      body: JSON.stringify({ name: groupName }),
      headers: {
        "Authorization": "Bearer " + this.authService.token
      }
    })
    if (!resp.ok) throw new Error("erro ao criar grupo")
    const data = await resp.json()
    await this.loadUserGroups()
    return data
  }

  @runInContext()
  async joinGroup(groupId: string): Promise<void> {
    await fetch("https://smart-finance-groups-production.up.railway.app/api/join/" + groupId, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + this.authService.token
      }
    })
    await this.loadUserGroups()
  }

  @runInContext()
  async createExpense(data: Omit<Expense, 'id' | 'date' | 'payerId'>): Promise<Expense> {
    throw new Error("criação de despesa não foi implementado")
  }

  @runInContext()
  async deleteExpense(groupId: string, expenseId: string): Promise<void> {
    throw new Error("deleção de despesa não foi implementado")
  }

  @runInContext()
  async createPayment(data: Omit<Payment, 'id' | 'date' | 'payerId'>): Promise<Payment> {
    throw new Error("criação de pagamentos não foi implementado")
  }

  getGroupByIdAsync(id: string): Group | undefined | Promise<Group | null> {
    if (this.groups()) return this.getGroupById(id);
    return this._getGroupDetails(id);
  }

  getGroupById(id: string): Group | undefined {
    return this.groups()?.find(g => g.id === id);
  }

  @runInContext()
  private async _getGroupDetails(groupId: string): Promise<Group | null> {
    try {
      const resp = await fetch("https://smart-finance-groups-production.up.railway.app/api/groups/" + groupId, {
        headers: {
          "Authorization": "Bearer " + this.authService.token
        }
      })
      if (!resp.ok) throw new Error("erro ao buscar grupo")
      const group: Group = await resp.json()
      if (group.expenses) group.expenses = Object.values(group.expenses)
      group.expenses?.forEach(e => e.date = new Date(e.date))

      return group;
    } catch (error) {
      console.error(`Falha ao buscar detalhes do grupo ${groupId}`, error);
      return null;
    }
  }
}