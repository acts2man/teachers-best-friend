import TeacherApp from "@/components/teacher-app";
import { notFound, redirect } from "next/navigation";

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

export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  // Student work now lives inside each assessment.
  if (view === "review") redirect("/assessments");
  if (!views.includes(view)) notFound();
  return <TeacherApp view={view === "reteach" ? "lessons" : view} />;
}
