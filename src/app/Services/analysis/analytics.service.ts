import { Injectable, inject } from '@angular/core';
import { AuthService } from '../auth/auth';

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
  owedBy: Debt[];
  oweTo: Debt[];
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
  private authService = inject(AuthService);

  private readonly API_URL =
    'https://smart-finance-analysis-production.up.railway.app/api/analysis';

  private async request<T>(url: string): Promise<T> {
    const token = this.authService.token;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Erro ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async getGroupAnalysis(groupId: string): Promise<GroupAnalysis> {
    return this.request<GroupAnalysis>(
      `${this.API_URL}/group/${groupId}`
    );
  }

  async getGeneralAnalysis(): Promise<GeneralAnalysis> {
    return this.request<GeneralAnalysis>(
      `${this.API_URL}/general`
    );
  }
}
