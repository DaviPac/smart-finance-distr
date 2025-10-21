import { Component, OnInit, inject, signal } from '@angular/core';
import { GroupsService } from '../../Services/group/group'; // Verifique os imports
import { CommonModule } from '@angular/common';
import { AuthService } from '../../Services/auth/auth'; // Verifique os imports
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';

@Component({
  selector: 'app-group-list',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './group-list.html',
})
export class GroupListComponent implements OnInit {
  private groupsService = inject(GroupsService);
  private authService = inject(AuthService);
  private fb = inject(NonNullableFormBuilder);
  private router = inject(Router);

  // Signals para controlar o estado da UI
  loading = this.groupsService.loading;
  adding = signal<boolean>(false);
  addLoading = signal<boolean>(false);
  groups = this.groupsService.groups;

  addForm = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(3)]]
  });

  ngOnInit() {
    if (!this.groupsService.groups()) this.groupsService.loadUserGroups();
  }

  navigateToGroup(groupId: string) {
    this.groupsService.currentGroup.set(this.groupsService.getGroupById(groupId) || null);
    this.router.navigate([`/groups/${groupId}`]);
  }

  openAddModal(): void {
    this.addForm.reset();
    this.adding.set(true);
  }

  closeAddModal(): void {
    this.adding.set(false);
  }

  async onSubmit() {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      return;
    }

    if (this.addForm.invalid) {
      return;
    }

    const currentUserId = this.authService.currentUser()?.uid;
    if (!currentUserId) {
      console.error("Usuário não logado, não é possível criar grupo.");
      return;
    }

    this.addLoading.set(true);
    const { name } = this.addForm.getRawValue();

    const newGroup = await this.groupsService.createGroup(name, currentUserId);
    this.adding.set(false);
    this.addForm.reset();
    this.addLoading.set(false);

  }
}