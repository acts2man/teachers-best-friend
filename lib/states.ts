// State standards frameworks. The framework value stored on a standard is the
// state name, so a catalog loaded for "Texas" is reused by every Texas class.
// California Grade 4 Math and ELA ship with the app; every other combination is
// retrieved with the AI service on request and saved to the teacher's library.
export type StateFramework = {
  state: string;
  abbr: string;
  framework: string;
  site: string;
};

export const stateFrameworks: StateFramework[] = [
  { state: "Alabama", abbr: "AL", framework: "Alabama Course of Study", site: "https://www.alabamaachieves.org" },
  { state: "Alaska", abbr: "AK", framework: "Alaska Content Standards", site: "https://education.alaska.gov" },
  { state: "Arizona", abbr: "AZ", framework: "Arizona Academic Standards", site: "https://www.azed.gov" },
  { state: "Arkansas", abbr: "AR", framework: "Arkansas Academic Standards", site: "https://dese.ade.arkansas.gov" },
  { state: "California", abbr: "CA", framework: "California Common Core State Standards", site: "https://www.cde.ca.gov" },
  { state: "Colorado", abbr: "CO", framework: "Colorado Academic Standards", site: "https://www.cde.state.co.us" },
  { state: "Connecticut", abbr: "CT", framework: "Connecticut Core Standards", site: "https://portal.ct.gov/sde" },
  { state: "Delaware", abbr: "DE", framework: "Delaware Standards", site: "https://www.doe.k12.de.us" },
  { state: "District of Columbia", abbr: "DC", framework: "DC Academic Standards", site: "https://osse.dc.gov" },
  { state: "Florida", abbr: "FL", framework: "B.E.S.T. Standards", site: "https://www.fldoe.org" },
  { state: "Georgia", abbr: "GA", framework: "Georgia's K-12 Standards", site: "https://www.gadoe.org" },
  { state: "Hawaii", abbr: "HI", framework: "Hawaii Common Core Standards", site: "https://www.hawaiipublicschools.org" },
  { state: "Idaho", abbr: "ID", framework: "Idaho Content Standards", site: "https://www.sde.idaho.gov" },
  { state: "Illinois", abbr: "IL", framework: "Illinois Learning Standards", site: "https://www.isbe.net" },
  { state: "Indiana", abbr: "IN", framework: "Indiana Academic Standards", site: "https://www.in.gov/doe" },
  { state: "Iowa", abbr: "IA", framework: "Iowa Core", site: "https://educate.iowa.gov" },
  { state: "Kansas", abbr: "KS", framework: "Kansas Standards", site: "https://www.ksde.gov" },
  { state: "Kentucky", abbr: "KY", framework: "Kentucky Academic Standards", site: "https://www.education.ky.gov" },
  { state: "Louisiana", abbr: "LA", framework: "Louisiana Student Standards", site: "https://www.louisianabelieves.com" },
  { state: "Maine", abbr: "ME", framework: "Maine Learning Results", site: "https://www.maine.gov/doe" },
  { state: "Maryland", abbr: "MD", framework: "Maryland College and Career-Ready Standards", site: "https://www.marylandpublicschools.org" },
  { state: "Massachusetts", abbr: "MA", framework: "Massachusetts Curriculum Frameworks", site: "https://www.doe.mass.edu" },
  { state: "Michigan", abbr: "MI", framework: "Michigan Academic Standards", site: "https://www.michigan.gov/mde" },
  { state: "Minnesota", abbr: "MN", framework: "Minnesota Academic Standards", site: "https://education.mn.gov" },
  { state: "Mississippi", abbr: "MS", framework: "Mississippi College- and Career-Readiness Standards", site: "https://www.mdek12.org" },
  { state: "Missouri", abbr: "MO", framework: "Missouri Learning Standards", site: "https://dese.mo.gov" },
  { state: "Montana", abbr: "MT", framework: "Montana Content Standards", site: "https://opi.mt.gov" },
  { state: "Nebraska", abbr: "NE", framework: "Nebraska College and Career Ready Standards", site: "https://www.education.ne.gov" },
  { state: "Nevada", abbr: "NV", framework: "Nevada Academic Content Standards", site: "https://doe.nv.gov" },
  { state: "New Hampshire", abbr: "NH", framework: "New Hampshire College and Career Ready Standards", site: "https://www.education.nh.gov" },
  { state: "New Jersey", abbr: "NJ", framework: "New Jersey Student Learning Standards", site: "https://www.nj.gov/education" },
  { state: "New Mexico", abbr: "NM", framework: "New Mexico Content Standards", site: "https://webnew.ped.state.nm.us" },
  { state: "New York", abbr: "NY", framework: "Next Generation Learning Standards", site: "https://www.nysed.gov" },
  { state: "North Carolina", abbr: "NC", framework: "North Carolina Standard Course of Study", site: "https://www.dpi.nc.gov" },
  { state: "North Dakota", abbr: "ND", framework: "North Dakota Content Standards", site: "https://www.nd.gov/dpi" },
  { state: "Ohio", abbr: "OH", framework: "Ohio's Learning Standards", site: "https://education.ohio.gov" },
  { state: "Oklahoma", abbr: "OK", framework: "Oklahoma Academic Standards", site: "https://sde.ok.gov" },
  { state: "Oregon", abbr: "OR", framework: "Oregon Academic Content Standards", site: "https://www.oregon.gov/ode" },
  { state: "Pennsylvania", abbr: "PA", framework: "PA Core Standards", site: "https://www.education.pa.gov" },
  { state: "Rhode Island", abbr: "RI", framework: "Rhode Island Core Standards", site: "https://ride.ri.gov" },
  { state: "South Carolina", abbr: "SC", framework: "South Carolina College- and Career-Ready Standards", site: "https://ed.sc.gov" },
  { state: "South Dakota", abbr: "SD", framework: "South Dakota Content Standards", site: "https://doe.sd.gov" },
  { state: "Tennessee", abbr: "TN", framework: "Tennessee Academic Standards", site: "https://www.tn.gov/education" },
  { state: "Texas", abbr: "TX", framework: "Texas Essential Knowledge and Skills (TEKS)", site: "https://tea.texas.gov" },
  { state: "Utah", abbr: "UT", framework: "Utah Core Standards", site: "https://www.schools.utah.gov" },
  { state: "Vermont", abbr: "VT", framework: "Vermont Content Standards", site: "https://education.vermont.gov" },
  { state: "Virginia", abbr: "VA", framework: "Standards of Learning (SOL)", site: "https://www.doe.virginia.gov" },
  { state: "Washington", abbr: "WA", framework: "Washington State Learning Standards", site: "https://ospi.k12.wa.us" },
  { state: "West Virginia", abbr: "WV", framework: "West Virginia College- and Career-Readiness Standards", site: "https://wvde.us" },
  { state: "Wisconsin", abbr: "WI", framework: "Wisconsin Academic Standards", site: "https://dpi.wi.gov" },
  { state: "Wyoming", abbr: "WY", framework: "Wyoming Content and Performance Standards", site: "https://edu.wyoming.gov" },
];

export function stateFor(framework: string) {
  return stateFrameworks.find((s) => s.state === framework);
}

export function frameworkLabel(framework: string) {
  const state = stateFor(framework);
  if (!state) return framework;
  return framework === "California"
    ? "California · CA Common Core"
    : state.state + " · " + state.framework;
}

// Dropdown order: the verified California set, generic Common Core, every
// state alphabetically, then any teacher-entered frameworks.
export function frameworkOptions(custom: string[] = []) {
  const seen = new Set<string>();
  const list: { value: string; label: string }[] = [];
  const push = (value: string, label: string) => {
    if (seen.has(value)) return;
    seen.add(value);
    list.push({ value, label });
  };
  push("California", frameworkLabel("California"));
  push("Common Core", "Common Core · CCSS");
  for (const s of stateFrameworks) push(s.state, frameworkLabel(s.state));
  for (const f of custom) if (f) push(f, f);
  return list;
}
