/**
 * One icon per expense category (Blueprint: every expense row and tile shows what kind of spend it is).
 * Also the colour each category takes in the "By category" bar, darkest for the largest share.
 */
import { Ellipsis, Fuel, Hammer, Package, Truck, Users, UtensilsCrossed, Wrench, Zap, type LucideIcon } from 'lucide-react-native';

import type { ExpenseCategory } from '@/db/types';

export const CATEGORY_ICON: Record<ExpenseCategory, LucideIcon> = {
  materials: Package,
  transport: Truck,
  fuel: Fuel,
  machinery: Wrench,
  food: UtensilsCrossed,
  tools: Hammer,
  subcontract: Users,
  utilities: Zap,
  other: Ellipsis,
};
