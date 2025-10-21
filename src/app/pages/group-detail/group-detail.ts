import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Group } from '../../models/group.model';
import { GroupsService } from '../../Services/group/group';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../Services/auth/auth';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Expense } from '../../models/expense.model';
import { User } from '../../models/user.model';
import { UsersService } from '../../Services/user/user';

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
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

  expenseForm = this.fb.group({
    description: ['', [Validators.required]],
    amount: [0, [Validators.required, Validators.min(0.01)]],
  });

  async ngOnInit() {
    this.loading.set(true);
    const groupId = this.route.snapshot.paramMap.get('groupId');

    if (!groupId) {
      console.error('ID do grupo não encontrado na rota!');
      this.loading.set(false);
      return;
    }

    const groupFromService = this.groupsService.currentGroup();

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
  }

  getAllExpenses(): number {
    let expenses = 0;
    this.group()?.expenses?.forEach(ex => expenses += ex.value);
    return expenses;
  }

  // --- Modal Control ---
  openAddExpenseModal(): void {
    this.expenseForm.reset();
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
    if (this.expenseForm.invalid) return;
    
    this.addExpenseLoading.set(true);
    const formValue = this.expenseForm.getRawValue();
    const currentGroupId = this.group()?.id;
    const currentUserId = this.authService.currentUser()?.email;

    if (!currentGroupId || !currentUserId) {
      console.error("Faltam dados do grupo ou do usuário para criar o gasto.");
      this.addExpenseLoading.set(false);
      return;
    }

    const newExpense = await this.groupsService.createExpense({
      groupId: currentGroupId,
      description: formValue.description,
      value: formValue.amount,
      category: 'outros'
    });
    this.group.update(g => {
      g?.expenses?.push(newExpense);
      return g;
    });
    this.addExpenseLoading.set(false);
    this.closeAddExpenseModal();
  }
}