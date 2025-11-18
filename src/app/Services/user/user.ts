import { inject, Injectable, Injector } from '@angular/core';
import { AuthService } from '../auth/auth';
import runInContext from '../../decorators/run-in-context-decorator';
import { User } from '../../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class UsersService {

  private authService: AuthService = inject(AuthService);
  injector = inject(Injector);

  @runInContext()
  async changeUsername(newName: string) {
    throw new Error("mudar nome nao implementado")
  }

  @runInContext()
  async getUserById(uid: string): Promise<User | null> {
    try {
      const resp = await fetch("https://smart-finance-auth-production.up.railway.app/api/users/" + uid, {
        headers: {
          "Authorization": "Bearer " + this.authService.token
        }
      })
      if (!resp.ok) return null
      const data = await resp.json()
      console.log(data)
      return data
    } catch (e) { return null }
  }

}