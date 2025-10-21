import { Injectable, Injector, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Auth, User as FirebaseUser, authState, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from '@angular/fire/auth';
import { User } from '../../models/user.model';
import { Database } from '@angular/fire/database';
import { child, get, ref, set } from 'firebase/database';
import runInContext from '../../decorators/run-in-context-decorator';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth: Auth = inject(Auth);
  private db: Database = inject(Database); 
  private router = inject(Router);

  readonly currentFirebaseUser = toSignal(authState(this.auth));
  currentUser = signal<User | null>(null);

  public readonly user$: Observable<FirebaseUser | null> = authState(this.auth);
  
  injector = inject(Injector);

  isAuthenticated() {
    return !!this.currentFirebaseUser();
  }

  isLoggedIn() {
    return !!this.currentUser();
  }

  @runInContext()
  async login(email: string, password: string): Promise<User | null> {
    try {
      const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
      await this.updateCurrentUser(userCredential.user.uid);
      return this.currentUser();
    } catch (error) {
      console.error("Erro no login:", error);
      return null;
    }
  }

  // Registro de Novos Usuários
  async register(email: string, password: string, name: string): Promise<FirebaseUser | null> {
    try {
      const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
      const user = userCredential.user;

      const userData = {
        uid: user.uid,
        email: user.email!,
        name: name
      }

      const userRef = ref(this.db, `users/${user.uid}`);
      await set(userRef, userData);

      this.currentUser.set(userData);

      return user;
    } catch (error) {
      console.error("Erro no registro:", error);
      return null;
    }
  }

  // Logout
  @runInContext()
  async logout(): Promise<void> {
    this.currentUser.set(null);
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }

  private async updateCurrentUser(uid: string): Promise<void> {
    if (!uid) {
      this.currentUser.set(null);
      return;
    }
    const userRef = ref(this.db);
    const snapshot = await get(child(userRef, `users/${uid}`));

    if (snapshot.exists()) {
      this.currentUser.set(snapshot.val() as User);
    } else {
      const currentFirebaseUser = this.currentFirebaseUser();
      if (!currentFirebaseUser) {
        console.log("Nao está logado");
        return;
      }
      console.error("Perfil do usuário não encontrado no Firestore! Atualizando dados...");
      const userData = {
        uid: currentFirebaseUser.uid,
        email: currentFirebaseUser.email!,
        name: 'Usuario'
      }
      try {
        const newUserRef = ref(this.db, `users/${currentFirebaseUser.uid}`);
        await set(newUserRef, userData);

        this.currentUser.set(userData);
      }
      catch (error: unknown) {
        const e = error as Error;
        console.log("Erro ao criar dados do usuario: " + e.message);
      }
    }
  }
}