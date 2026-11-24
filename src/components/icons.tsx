import {
  Archive,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Cloud,
  Database,
  Download,
  Info,
  LayoutGrid,
  List,
  Lock,
  Maximize2,
  MessageSquare,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

export type IconName =
  | 'plus'
  | 'back'
  | 'forward'
  | 'settings'
  | 'book'
  | 'users'
  | 'chart'
  | 'database'
  | 'sun'
  | 'moon'
  | 'lock'
  | 'maximize'
  | 'trash'
  | 'edit'
  | 'search'
  | 'download'
  | 'upload'
  | 'calendar'
  | 'grade'
  | 'check'
  | 'close'
  | 'clock'
  | 'alert'
  | 'archive'
  | 'grid'
  | 'list'
  | 'info'
  | 'cloud'
  | 'message'
  | 'more';

const ICONS: Record<IconName, LucideIcon> = {
  plus: Plus,
  back: ChevronLeft,
  forward: ChevronRight,
  settings: Settings,
  book: BookOpen,
  users: Users,
  chart: BarChart3,
  database: Database,
  sun: Sun,
  moon: Moon,
  lock: Lock,
  maximize: Maximize2,
  trash: Trash2,
  edit: Pencil,
  search: Search,
  download: Download,
  upload: Upload,
  calendar: CalendarDays,
  grade: ClipboardCheck,
  check: Check,
  close: X,
  clock: Clock,
  alert: TriangleAlert,
  archive: Archive,
  grid: LayoutGrid,
  list: List,
  info: Info,
  cloud: Cloud,
  message: MessageSquare,
  more: MoreHorizontal,
};

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 22, strokeWidth = 1.8, className }: IconProps) {
  const Component = ICONS[name];
  return <Component size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" />;
}
