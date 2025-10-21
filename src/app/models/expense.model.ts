export interface Expense {
    id: string;
    date: Date;
    payerId: string;
    groupId: string;
    value: number;
    description: string;
    category: string;
}