import TeacherApp from "@/components/teacher-app";
import { notFound } from "next/navigation";
export default async function Page({params}:{params:Promise<{view:string}>}) { const {view}=await params; if(!["assessments","scan","standards","diagnostics","reteach","students","resources","settings"].includes(view)) notFound(); return <TeacherApp view={view} />; }
