import { SectionLayout } from "../section-tabs";

export default function Layout({ children }: LayoutProps<"/databases">) {
  return <SectionLayout>{children}</SectionLayout>;
}
