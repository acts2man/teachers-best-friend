import type { Metadata } from "next";
import "./globals.css";
import { CanonicalRedirect } from "@/components/canonical-redirect";
export const metadata:Metadata={title:"A Teacher’s Best Friend · Teach with clarity",description:"Review assignments, confirm student answers, and choose focused reteaching.",icons:{icon:"/brand/teacher-book.png"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body><CanonicalRedirect />{children}</body></html>}
