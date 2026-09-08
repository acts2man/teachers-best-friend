"use client";
import {createContext,useContext} from "react";
import type {Workspace,Classroom,Standard,Student,Assessment} from "@/lib/teacher-types";
export type TeacherContextType={w:Workspace;classroom:Classroom;students:Student[];assessments:Assessment[];catalog:Standard[];loaded:boolean;busy:boolean;aiReady:boolean;save:(next:Workspace,message?:string)=>Promise<boolean>;reload:()=>Promise<void>;go:(url:string)=>void};
export const TeacherContext=createContext<TeacherContextType>(null!);
export function useTeacher(){return useContext(TeacherContext)}
