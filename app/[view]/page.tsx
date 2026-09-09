import TeacherApp from "@/components/teacher-app";

// Every screen is rendered entirely on the client from the teacher's saved
// workspace, so the pages themselves are static files. Netlify serves them from
// its edge cache and the sidebar links prefetch them, which makes switching
// screens instant instead of waiting on a server function for each click.
const views = [
  "assessments",
  "scan",
  "standards",
  "diagnostics",
  "lessons",
  "reteach",
  "students",
  "classes",
  "resources",
  "settings",
  "guide",
];

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return views.map((view) => ({ view }));
}

export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  return <TeacherApp view={view === "reteach" ? "lessons" : view} />;
}
