import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"A Teacher’s Best Friend · Teach with clarity",description:"Review assignments, confirm student answers, and choose focused reteaching.",icons:{icon:"/brand/teacher-book.png"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
