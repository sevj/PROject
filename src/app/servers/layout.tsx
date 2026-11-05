import { SectionLayout } from "../section-tabs";

export default function Layout({ children }: LayoutProps<"/servers">) {
  return <SectionLayout>{children}</SectionLayout>;
}
