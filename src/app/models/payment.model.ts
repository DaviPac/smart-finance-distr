export interface Payment {
    id?: string;
    value: number;
    date: string;
    payerId: string;
    groupId: string;
    targetId: string;
}