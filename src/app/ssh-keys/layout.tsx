import { SectionLayout } from "../section-tabs";

export default function Layout({ children }: LayoutProps<"/ssh-keys">) {
  return <SectionLayout>{children}</SectionLayout>;
}
