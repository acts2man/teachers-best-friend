import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"A Teacher’s Best Friend · Teach with clarity",description:"Turn student work into clear insights, thoughtful small groups, and your next great lesson.",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
