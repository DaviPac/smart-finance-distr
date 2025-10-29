import { Routes } from '@angular/router';
import { Home } from './pages/home/home';
import { Login } from './pages/login/login';
import { authGuard } from './Services/auth/auth-guard';
import { loginGuard } from './Services/auth/login-guard-guard';
import { GroupListComponent } from './pages/group-list/group-list';
import { GroupDetail } from './pages/group-detail/group-detail';
import { Profile } from './pages/profile/profile';

export const routes: Routes = [
    { path: '', component: Home, canActivate: [authGuard] },
    { path: 'login', component: Login, canActivate: [loginGuard] },
    { path: 'groups', component: GroupListComponent, canActivate: [authGuard] },
    { path: 'groups/:groupId', component: GroupDetail, canActivate: [authGuard] },
    { path: 'profile', component: Profile, canActivate: [authGuard] }
];
