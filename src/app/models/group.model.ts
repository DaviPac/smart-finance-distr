import { Expense } from "./expense.model";

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
  ownerId: string;
  expenses?: Expense[]
}