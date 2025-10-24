import { Expense } from "./expense.model";
import { Payment } from "./payment.model";

export interface Group {
  id: string;
  name: string;
  memberIds: string[];
  ownerId: string;
  expenses?: Expense[];
  payments?: Payment[];
}