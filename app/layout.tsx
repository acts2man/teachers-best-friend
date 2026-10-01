import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CanonicalRedirect } from "@/components/canonical-redirect";
export const metadata:Metadata={title:"A Teacher’s Best Friend · Teach with clarity",description:"Review assignments, confirm student answers, and choose focused reteaching.",manifest:"/manifest.webmanifest",icons:{icon:"/brand/teacher-book.png",apple:"/icons/apple-touch-icon.png"},appleWebApp:{capable:true,statusBarStyle:"default",title:"Best Friend"}};
// themeColor belongs on the viewport export in the App Router. The manifest
// (app/manifest.ts) carries the installable-app identity and icons.
export const viewport:Viewport={themeColor:"#233f36"};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body><CanonicalRedirect />{children}</body></html>}
