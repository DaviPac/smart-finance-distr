import { inject, Injectable, Injector } from '@angular/core';
import { Database, get, ref, set } from '@angular/fire/database';
import { AuthService } from '../auth/auth';
import runInContext from '../../decorators/run-in-context-decorator';
import { child } from 'firebase/database';
import { User } from '../../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class UsersService {

  //- Injeção de Dependências
  private db: Database = inject(Database);
  private authService: AuthService = inject(AuthService);
  injector = inject(Injector);

  @runInContext()
  async changeUsername(newName: string) {
    try {
      const user = this.authService.currentUser();
      if (!user) return;
      const newUserData: User = {
        ...user,
        name: newName
      };
      const userRef = ref(this.db, `users/${user.uid}`);
      await set(userRef, newUserData);
    }
    catch (e: unknown) {
      const error = e as Error;
      console.log(error.message);
      throw error;
    }
  }

  @runInContext()
  async getUserById(uid: string): Promise<User | null> {
      const userRef = ref(this.db);
      const snapshot = await get(child(userRef, `users/${uid}`));
      if (snapshot.exists()) return snapshot.val() as User;
      return null
  }

}