import { requireRegressionAdmin } from "@/lib/regression/gate";
import { RegressionConsole } from "@/components/admin/regression-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test cases", robots: { index: false, follow: false } };

/**
 * The regression replay. Outside /admin on purpose: the admin layout redirects
 * a non-admin to the home page, which confirms the page exists. This one
 * answers 404 to everyone not on regression_admins -- signed out, teacher, or
 * an admin who has not been added -- exactly like a page that is not there.
 */
export default async function RegressionPage() {
  await requireRegressionAdmin();
  return <RegressionConsole />;
}
