import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth';
import { firstValueFrom } from 'rxjs';

export interface Debt {
  userId: string;
  amount: number;
}

export interface GroupAnalysis {
  groupId: string;
  groupName: string;
  myBalance: number;       
  totalSpent: number;      
  myTotalSpent: number;    
  owedBy: Debt[];          // Quem me deve
  oweTo: Debt[];           // A quem eu devo
  categorySummary: { [key: string]: number }; 
}

export interface GeneralAnalysis {
  totalBalance: number;
  totalOwedByMe: number;
  totalOwedToMe: number;
  categorySummary: { [key: string]: number };
}

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);

  // URL do microsserviço de análise
  private readonly API_URL = 'smart-finance-analysis-production.up.railway.app/api/analysis';

  async getGroupAnalysis(groupId: string): Promise<GroupAnalysis> {
    const token = this.authService.token;
    return firstValueFrom(
      this.http.get<GroupAnalysis>(`${this.API_URL}/group/${groupId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    );
  }

  async getGeneralAnalysis(): Promise<GeneralAnalysis> {
    const token = this.authService.token
    
    return firstValueFrom(
      this.http.get<GeneralAnalysis>(`${this.API_URL}/general`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
    );
  }
}