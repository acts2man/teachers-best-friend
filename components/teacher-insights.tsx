"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowUpRight,
  Search,
  Plus,
  Target,
  Check,
  BookOpen,
  Layers,
  Lightbulb,
  Users,
  TrendingUp,
  Download,
  Pencil,
  Trash2,
  Eye,
  GitBranch,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useTeacher } from "./teacher-context";
import {
  Action,
  PageTitle,
  SectionTitle,
  Pick,
  Pill,
  Score,
  Meter,
  Avatar,
  AvatarStack,
  Ring,
  EmptyState,
  Modal,
  Insight,
  TextLink,
  downloadText,
} from "./teacher-shared";
import { allStandards } from "@/lib/teacher-catalog";
import { frameworkLabel, frameworkOptions, stateFor } from "@/lib/states";
import { RosterScanner, StandardsLoader } from "./teacher-classes";
import {
  performanceBands,
  sharedGapGroups,
  studentOverall,
} from "@/lib/teacher-metrics";
import {
  standards,
  classroomColors,
  mastery,
  masteryStatus,
  classMastery,
  priorities,
} from "@/lib/teacher-data";
import type { Standard, Student, Group } from "@/lib/teacher-types";

export function StandardsView() {
  const { w, classroom, save, busy, go } = useTeacher();
  const [query, setQuery] = useState(""),
    [subject, setSubject] = useState("All subjects"),
    [framework, setFramework] = useState(classroom.framework),
    [grade, setGrade] = useState(String(classroom.grade)),
    [detail, setDetail] = useState<Standard | null>(null),
    [add, setAdd] = useState(false),
    [code, setCode] = useState(""),
    [title, setTitle] = useState(""),
    [summary, setSummary] = useState(""),
    [skills, setSkills] = useState(""),
    [customFramework, setCustomFramework] = useState("District standards"),
    [customSubject, setCustomSubject] = useState("Math");
  const all = allStandards(w),
    filtered = all.filter(
      (s) =>
        s.framework === framework &&
        s.grade === Number(grade) &&
        (subject === "All subjects" || s.subject === subject) &&
        (s.code + " " + s.title + " " + s.summary + " " + s.skills.join(" "))
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  async function addStandard() {
    if (
      !code.trim() ||
      !title.trim() ||
      !summary.trim() ||
      !customFramework.trim()
    )
      return;
    if (
      all.some(
        (s) =>
          s.code === code.trim() &&
          s.framework === customFramework.trim() &&
          s.grade === Number(grade),
      )
    ) {
      toast.error("That standard already exists in this framework.");
      return;
    }
    const standard: Standard = {
      code: code.trim(),
      title: title.trim(),
      summary: summary.trim(),
      subject: customSubject as Standard["subject"],
      grade: Number(grade),
      framework: customFramework.trim(),
      domain: "District-defined",
      cluster: "Custom standard",
      skills: skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      prerequisites: [],
      next: [],
      vocabulary: [],
      misconception: "Review student work for recurring skill gaps.",
      example: "Add an aligned example when reviewing an assessment.",
      dok: 2,
      source: "",
    };
    if (
      await save(
        { ...w, customStandards: [...w.customStandards, standard] },
        "Standard added to your library",
      )
    ) {
      setFramework(customFramework.trim());
      setAdd(false);
      setCode("");
      setTitle("");
      setSummary("");
      setSkills("");
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="KNOW THE SKILL. SEE THE CONNECTION."
        title="Standards"
        description="Find the expectations for the grade and subject you’re teaching."
      >
        <Action onClick={() => setAdd(true)}>
          <Plus size={17} />
          Add district standard
        </Action>
      </PageTitle>
      <div className="filter-bar wrap">
        <label className="search-box">
          <Search size={17} />
          <input
            aria-label="Search standards"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a standard, skill, or keyword…"
          />
        </label>
        <Pick
          label="Standards framework"
          value={framework}
          onChange={setFramework}
          options={frameworkOptions([
            "District standards",
            ...w.customStandards.map((s) => s.framework),
          ])}
        />
        <Pick
          label="Grade"
          value={grade}
          onChange={setGrade}
          options={Array.from({ length: 13 }, (_, i) => ({
            value: String(i),
            label: i === 0 ? "Kindergarten" : "Grade " + i,
          }))}
        />
        <Pick
          label="Subject"
          value={subject}
          onChange={setSubject}
          options={["All subjects", "Math", "ELA"]}
        />
      </div>
      <div className="library-intro">
        <span className="soft-icon">
          <GitBranch size={22} />
        </span>
        <div>
          <strong>{frameworkLabel(framework)}</strong>
          <p>
            California Grade 4 Math and ELA are built in with official wording.
            Every other state and grade is retrieved with AI and saved here.
          </p>
        </div>
        <Pill>{filtered.length} standards</Pill>
      </div>
      {filtered.length > 0 &&
        stateFor(framework) &&
        !(framework === "California" && Number(grade) === 4) && (
          <div className="standards-note">
            <Lightbulb size={15} />
            <span>
              These standards were retrieved with AI. Check codes and wording
              against the official {stateFor(framework)!.framework} document
              before relying on them.{" "}
              <a href={stateFor(framework)!.site} target="_blank" rel="noreferrer">
                Official source
              </a>
            </span>
          </div>
        )}
      <div className="standards-grid">
        {filtered.map((s) => (
          <button
            className="panel standard-card"
            key={s.framework + s.code}
            onClick={() => setDetail(s)}
          >
            <div>
              <Pill tone={s.subject === "Math" ? "green" : "purple"}>
                {s.subject}
              </Pill>
              <ArrowUpRight size={19} />
            </div>
            <span className="standard-code">{s.code}</span>
            <h2>{s.title}</h2>
            <p>{s.summary}</p>
            <div className="standard-card-footer">
              <span>
                {s.skills.length
                  ? s.skills.length + " component skills"
                  : "Official standard"}
              </span>
              <span>{s.officialCode || s.code}</span>
            </div>
          </button>
        ))}
      </div>
      {!filtered.length && !query && (stateFor(framework) || framework === "Common Core") && (
        <StandardsLoader
          grade={Number(grade)}
          framework={framework}
          subject={subject === "All subjects" ? undefined : subject}
        />
      )}
      {!filtered.length && (
        <EmptyState
          title={
            query
              ? "No standards match that search"
              : "Or add a standard by hand"
          }
          description={
            query
              ? "Try a broader skill or standard code."
              : "This framework or grade hasn’t been added yet. Add your school’s standards to start matching assessments."
          }
        >
          <Action
            onClick={() => {
              setCustomFramework(framework);
              setAdd(true);
            }}
          >
            Add a standard
            <Plus size={16} />
          </Action>
        </EmptyState>
      )}
      <Sheet open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <SheetContent className="review-sheet standard-sheet">
          <SheetHeader>
            <SheetTitle>{detail?.code}</SheetTitle>
            <SheetDescription>
              {detail?.framework} · Grade {detail?.grade} · {detail?.subject}
            </SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="sheet-scroll">
              <h2 className="detail-title">{detail.title}</h2>
              <Pill tone="green">{detail.domain}</Pill>
              <div className="standard-summary">
                <span className="eyebrow">
                  {detail.wording
                    ? "OFFICIAL CALIFORNIA WORDING"
                    : "TEACHER-FRIENDLY SUMMARY"}
                </span>
                <p>{detail.summary}</p>
                {detail.source && (
                  <a
                    className="text-link"
                    href={detail.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Read the official standard
                    <ArrowUpRight size={15} />
                  </a>
                )}
              </div>
              <SectionTitle title="The skills inside the standard" />
              <div className="micro-skills">
                {detail.skills.map((s, i) => (
                  <div key={s}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <p>{s}</p>
                  </div>
                ))}
              </div>
              <div className="prerequisite-map">
                <div>
                  <span>BEFORE THIS</span>
                  {detail.prerequisites.length ? (
                    detail.prerequisites.map((p) => <Pill key={p}>{p}</Pill>)
                  ) : (
                    <p>Not yet mapped</p>
                  )}
                </div>
                <ArrowRight size={20} />
                <div>
                  <span>IN FOCUS</span>
                  <Pill tone="green">{detail.code}</Pill>
                </div>
                <ArrowRight size={20} />
                <div>
                  <span>UP NEXT</span>
                  {detail.next.length ? (
                    detail.next.map((p) => <Pill key={p}>{p}</Pill>)
                  ) : (
                    <p>Not yet mapped</p>
                  )}
                </div>
              </div>
              <div className="detail-block">
                <h3>A misconception to look for</h3>
                <p>{detail.misconception}</p>
              </div>
              <div className="detail-block">
                <h3>Try a question like this</h3>
                <p>{detail.example}</p>
              </div>
              {detail.vocabulary.length > 0 && (
                <div className="detail-block">
                  <h3>Words that matter</h3>
                  <div className="tag-list">
                    {detail.vocabulary.map((v) => (
                      <Pill key={v}>{v}</Pill>
                    ))}
                  </div>
                </div>
              )}
              <Action
                onClick={() =>
                  go(
                    "/lessons?standard=" +
                      encodeURIComponent(detail.code) +
                      "&framework=" +
                      encodeURIComponent(detail.framework) +
                      "&grade=" +
                      detail.grade,
                  )
                }
              >
                Explore a reteach lesson
                <ArrowRight size={16} />
              </Action>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Modal
        open={add}
        onClose={() => setAdd(false)}
        title="Add your school’s standard"
        description="Use the exact framework and code your school recognizes."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addStandard();
          }}
          className="form-stack"
        >
          <div className="form-grid">
            <label>
              Framework
              <input
                required
                value={customFramework}
                onChange={(e) => setCustomFramework(e.target.value)}
              />
            </label>
            <label>
              Standard code
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. 4.4D"
              />
            </label>
          </div>
          <label>
            Title
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="form-grid">
            <label>
              Grade
              <Pick
                label="Grade"
                value={grade}
                onChange={setGrade}
                options={Array.from({ length: 13 }, (_, i) => ({
                  value: String(i),
                  label: "Grade " + i,
                }))}
              />
            </label>
            <label>
              Subject
              <Pick
                label="Subject"
                value={customSubject}
                onChange={setCustomSubject}
                options={["Math", "ELA"]}
              />
            </label>
          </div>
          <label>
            Standard wording or approved summary
            <textarea
              required
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          <label>
            Component skills, separated by commas
            <textarea
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Decompose numbers, Use partial products, Explain reasoning"
            />
          </label>
          <Action type="submit" disabled={busy}>
            Save standard
            <Check size={16} />
          </Action>
        </form>
      </Modal>
    </>
  );
}

export function DiagnosticsView() {
  const { w, students, assessments, catalog, classroom, save, busy, go } =
    useTeacher();
  const params = useSearchParams(),
    ranked = priorities(students, catalog);
  const [focus, setFocus] = useState(
      ranked[0]?.standard.code || catalog[0]?.code || "",
    ),
    [tab, setTab] = useState("insights"),
    [diagnose, setDiagnose] = useState(false),
    [editGroup, setEditGroup] = useState<Group | null>(null),
    [responseIndex, setResponseIndex] = useState(0);
  useEffect(() => {
    const code = params.get("standard");
    if (code) setFocus(code);
  }, [params]);
  const s = catalog.find((s) => s.code === focus),
    priority = ranked.find((p) => p.standard.code === focus),
    groups = w.groups.filter((g) => g.classId === classroom.id),
    incorrect = assessments.flatMap((a) =>
      a.responses
        .filter(
          (r) =>
            !r.correct &&
            r.verified &&
            a.questions.some(
              (q) =>
                q.id === r.questionId && q.standard === focus && !q.excluded,
            ),
        )
        .map((r) => ({
          a,
          r,
          q: a.questions.find((q) => q.id === r.questionId)!,
        })),
    ),
    example = incorrect[responseIndex] || incorrect[0];
  const cross = students.filter((st) => {
    const m = mastery(st, "4.OA.A.3"),
      r = mastery(st, "RI.4.2");
    return m !== null && r !== null && m < 70 && r < 70;
  });
  async function generateGroups() {
    const map = new Map<string, string[]>();
    for (const st of students) {
      const ordered = catalog
        .map((s) => ({ s, m: mastery(st, s.code) }))
        .filter((x): x is { s: Standard; m: number } => x.m !== null)
        .sort((a, b) => a.m - b.m);
      const weakest = ordered[0];
      const key =
        weakest && weakest.m < 70
          ? weakest.s.code
          : catalog.length &&
              catalog.every((s) => masteryStatus(st, s.code) === "Mastered")
            ? "Enrichment"
            : "Independent practice";
      map.set(key, [...(map.get(key) || []), st.id]);
    }
    const next = [...map].map(([code, ids]) => ({
      id: crypto.randomUUID(),
      classId: classroom.id,
      name: catalog.find((s) => s.code === code)?.title || code,
      standard: catalog.some((s) => s.code === code) ? code : "",
      studentIds: ids,
    }));
    await save(
      {
        ...w,
        groups: [
          ...w.groups.filter((g) => g.classId !== classroom.id),
          ...next,
        ],
      },
      "Groups created from each student’s current priority",
    );
  }
  return (
    <>
      <PageTitle
        eyebrow="UNDERSTANDING THE WHY CHANGES THE HOW"
        title="A clearer class picture"
        description="Find the patterns behind the scores, then choose a thoughtful next step."
      >
        <Action
          onClick={() => go("/lessons?standard=" + focus)}
          disabled={!focus}
        >
          <Lightbulb size={17} />
          Plan the next lesson
        </Action>
      </PageTitle>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="page-tabs">
          <TabsTrigger value="insights">Learning insights</TabsTrigger>
          <TabsTrigger value="heatmap">Standards heatmap</TabsTrigger>
          <TabsTrigger value="groups">
            Instructional groups <span>{groups.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="insights">
          {ranked.length ? (
            <>
              <div className="insight-card-grid">
                {ranked.slice(0, 3).map((p, i) => (
                  <button
                    key={p.standard.code}
                    onClick={() => {
                      setFocus(p.standard.code);
                      setResponseIndex(0);
                    }}
                    className={
                      "focus-card panel " +
                      (focus === p.standard.code ? "selected" : "")
                    }
                  >
                    <div>
                      <span className={"priority-num c" + i}>0{i + 1}</span>
                      <Pill tone={i === 0 ? "amber" : "neutral"}>{p.tier}</Pill>
                    </div>
                    <h2>{p.standard.title}</h2>
                    <span>{p.standard.code}</span>
                    <div className="focus-card-footer">
                      <AvatarStack students={p.students} limit={3} />
                      <strong>
                        {p.students.length}
                        <span> need support</span>
                      </strong>
                    </div>
                    <Meter
                      value={p.mastery}
                      tone={i === 0 ? "orange" : i === 1 ? "purple" : "green"}
                    />
                  </button>
                ))}
              </div>
              <div className="diagnostic-workspace">
                <section className="panel diagnosis-focus">
                  <SectionTitle
                    title="Why did they miss it?"
                    description="A closer look at the thinking, not just the answer."
                  >
                    <Pick
                      label="Focus standard"
                      value={focus}
                      onChange={(v) => {
                        setFocus(v);
                        setResponseIndex(0);
                      }}
                      options={catalog.map((s) => ({
                        value: s.code,
                        label: s.code + " · " + s.title,
                      }))}
                    />
                  </SectionTitle>
                  {example ? (
                    <>
                      <div className="diagnosis-question">
                        <Pill tone="green">
                          Q{example.q.number} · {example.q.standard}
                        </Pill>
                        <p>{example.q.text}</p>
                        {example.q.passage && (
                          <details>
                            <summary>Read associated passage</summary>
                            <p>{example.q.passage}</p>
                          </details>
                        )}
                      </div>
                      <div className="thinking-comparison">
                        <div>
                          <span>THE STUDENT’S RESPONSE</span>
                          <strong>{example.r.answer}</strong>
                          <small>
                            {
                              students.find((s) => s.id === example.r.studentId)
                                ?.name
                            }{" "}
                            ·{" "}
                            {example.r.verified
                              ? "Teacher reviewed"
                              : "Pending review"}
                          </small>
                        </div>
                        <ArrowRight size={22} />
                        <div>
                          <span>EXPECTED RESPONSE</span>
                          <strong>{example.q.answer}</strong>
                          <small>{example.q.skill}</small>
                        </div>
                      </div>
                      <div className="breakdown">
                        <span className="breakdown-icon">
                          <Lightbulb size={22} />
                        </span>
                        <div>
                          <span className="eyebrow">LIKELY BREAKDOWN</span>
                          <h3>
                            {example.r.misconception || "Needs a closer look"}
                          </h3>
                          <p>{s?.misconception}</p>
                        </div>
                      </div>
                      <div className="diagnosis-bottom">
                        <span>One response is a clue, not a conclusion.</span>
                        <Action
                          variant="secondary small"
                          onClick={() => setDiagnose(true)}
                        >
                          Follow the thinking
                          <ArrowUpRight size={16} />
                        </Action>
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      title="Let’s gather the evidence"
                      description="Verify student responses to explore the question, response, and possible breakdown."
                    >
                      <Action onClick={() => go("/assessments")}>
                        Review student work
                      </Action>
                    </EmptyState>
                  )}
                </section>
                <aside className="panel focus-next">
                  <span className="soft-icon">
                    <Target size={24} />
                  </span>
                  <h2>A focused next step</h2>
                  <p>{s?.title}</p>
                  <div className="focus-next-stat">
                    <strong>{priority?.students.length || 0}</strong>
                    <span>students to check in with</span>
                  </div>
                  <div className="mini-student-list">
                    {priority?.students.slice(0, 5).map((st) => (
                      <button
                        onClick={() => go("/students?id=" + st.id)}
                        key={st.id}
                      >
                        <Avatar student={st} size="small" />
                        <span>{st.name}</span>
                        <Score value={mastery(st, focus)} />
                      </button>
                    ))}
                  </div>
                  {priority && priority.students.length > 5 && (
                    <span className="field-help">
                      + {priority.students.length - 5} more students
                    </span>
                  )}
                  <Action onClick={() => go("/lessons?standard=" + focus)}>
                    Reteach this skill
                    <ArrowRight size={16} />
                  </Action>
                </aside>
              </div>
              {cross.length > 0 && (
                <div className="cross-insight">
                  <GitBranch size={26} />
                  <div>
                    <span className="eyebrow">A POSSIBLE CONNECTION</span>
                    <h3>
                      {cross.length} students need support with both word
                      problems and main idea.
                    </h3>
                    <p>
                      Check how they identify relevant information before
                      assuming the barrier is calculation. This overlap is a
                      prompt to investigate, not proof of a cause.
                    </p>
                  </div>
                  <Action
                    variant="secondary"
                    onClick={() => {
                      setFocus("RI.4.2");
                      setResponseIndex(0);
                    }}
                  >
                    Explore reading skills
                    <ArrowRight size={16} />
                  </Action>
                </div>
              )}
              <p className="method-note">
                Priority combines the share of students below 70%, the number
                affected, and a prerequisite-impact weight. Use this planning
                aid alongside your observations.
              </p>
            </>
          ) : (
            <EmptyState
              title="New insights are on the way"
              description="Add verified student work or dated skill evidence to reveal reteaching priorities."
            >
              <Action onClick={() => go("/students")}>
                Open student mastery
              </Action>
            </EmptyState>
          )}
        </TabsContent>
        <TabsContent value="heatmap">
          <div className="panel heatmap-panel">
            <SectionTitle
              title="Every learner. Every next step."
              description="Select any score to open the student’s evidence."
            >
              <div className="heatmap-legend">
                <span className="good">80%+</span>
                <span className="medium">65–79%</span>
                <span className="low">Below 65%</span>
              </div>
            </SectionTitle>
            {students.length && catalog.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    {catalog.map((s) => (
                      <TableHead key={s.code}>
                        <button
                          onClick={() => {
                            setFocus(s.code);
                            setTab("insights");
                          }}
                          title={s.title}
                        >
                          {s.code}
                          <ArrowUpRight size={12} />
                        </button>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="class-average">
                    <TableCell>Class average</TableCell>
                    {catalog.map((s) => (
                      <TableCell key={s.code}>
                        <Score value={classMastery(students, s.code)} />
                      </TableCell>
                    ))}
                  </TableRow>
                  {students.map((st) => (
                    <TableRow key={st.id}>
                      <TableCell>
                        <button
                          className="student-name"
                          onClick={() => go("/students?id=" + st.id)}
                        >
                          <Avatar student={st} size="small" />
                          {st.name}
                        </button>
                      </TableCell>
                      {catalog.map((s) => (
                        <TableCell key={s.code}>
                          <button
                            className="heat-cell"
                            onClick={() =>
                              go(
                                "/students?id=" + st.id + "&standard=" + s.code,
                              )
                            }
                            aria-label={
                              st.name +
                              ", " +
                              s.title +
                              ", " +
                              (mastery(st, s.code) ?? "no") +
                              " percent"
                            }
                          >
                            <Score value={mastery(st, s.code)} />
                          </button>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState
                title="Your mastery map will grow here"
                description="Add students and standards, then record evidence."
              />
            )}
            <p className="method-note">
              Scores average the three most recent evidence records. “Mastered”
              additionally requires at least three records.
            </p>
          </div>
        </TabsContent>
        <TabsContent value="groups">
          <div className="groups-header">
            <div>
              <h2>The right support, together.</h2>
              <p>
                Suggested groups use each student’s largest current gap. Adjust
                them with what you know.
              </p>
            </div>
            <Action
              onClick={generateGroups}
              disabled={!students.length || busy}
            >
              <Lightbulb size={16} />
              {groups.length
                ? "Refresh suggested groups"
                : "Create instructional groups"}
            </Action>
          </div>
          <div className="groups-grid">
            {groups.map((g, i) => (
              <section className={"panel group-card c" + (i % 4)} key={g.id}>
                <div>
                  <span className="group-icon">
                    <Users size={24} />
                  </span>
                  <Pill>{g.studentIds.length} students</Pill>
                </div>
                <h2>{g.name}</h2>
                <span className="cell-meta">
                  {g.standard || "Flexible practice"}
                </span>
                <div className="group-members">
                  {g.studentIds
                    .map((id) => students.find((s) => s.id === id))
                    .filter((s): s is Student => !!s)
                    .map((s) => (
                      <span key={s.id}>
                        <Avatar student={s} size="small" />
                        {s.name}
                      </span>
                    ))}
                </div>
                <div className="group-actions">
                  <button
                    className="text-link"
                    onClick={() => setEditGroup({ ...g })}
                  >
                    Edit group
                    <Pencil size={14} />
                  </button>
                  <button
                    className="text-link"
                    onClick={() =>
                      go(
                        g.standard
                          ? "/lessons?standard=" + g.standard
                          : "/resources?category=" +
                              (g.name === "Enrichment"
                                ? "Enrichment"
                                : "Practice"),
                      )
                    }
                  >
                    Plan a lesson
                    <ArrowRight size={15} />
                  </button>
                </div>
              </section>
            ))}
          </div>
          {!groups.length && (
            <EmptyState
              title="Small groups. Meaningful breakthroughs."
              description="Create flexible groups from current evidence, then make the final adjustments."
            />
          )}
        </TabsContent>
      </Tabs>
      <Modal
        open={diagnose}
        onClose={() => setDiagnose(false)}
        title="Follow the thinking"
        description="Use the student’s work to test a likely explanation."
        wide
      >
        {example && (
          <div className="form-stack">
            <Pick
              label="Choose a response"
              value={String(responseIndex)}
              onChange={(v) => setResponseIndex(Number(v))}
              options={incorrect.map((x, i) => ({
                value: String(i),
                label:
                  (students.find((s) => s.id === x.r.studentId)?.name ||
                    "Student") +
                  " · Question " +
                  x.q.number,
              }))}
            />
            <div className="thinking-steps">
              {[
                { name: "The question", text: example.q.text },
                { name: "The response", text: example.r.answer },
                {
                  name: "Expected thinking",
                  text: example.q.skill + ". " + example.q.reasoning,
                },
                {
                  name: "Likely breakdown",
                  text:
                    example.r.misconception || "More information is needed.",
                },
              ].map((x, i) => (
                <div key={x.name}>
                  <span>{i + 1}</span>
                  <div>
                    <h3>{x.name}</h3>
                    <p>{x.text}</p>
                  </div>
                </div>
              ))}
            </div>
            <Insight>
              Ask the student to explain their first step aloud. Compare that
              explanation with written work before deciding what to reteach.
            </Insight>
            <div className="modal-actions">
              <Action
                variant="secondary"
                onClick={() =>
                  go("/assessments?id=" + example.a.id + "&tab=responses")
                }
              >
                Review the response
                <Pencil size={15} />
              </Action>
              <Action onClick={() => go("/lessons?standard=" + focus)}>
                Build a targeted lesson
                <ArrowRight size={15} />
              </Action>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={!!editGroup}
        onClose={() => setEditGroup(null)}
        title="Shape your small group"
        description="Groups are flexible. Add or remove students based on what you observe."
      >
        {editGroup && (
          <div className="form-stack">
            <label>
              Group name
              <input
                value={editGroup.name}
                onChange={(e) =>
                  setEditGroup({ ...editGroup, name: e.target.value })
                }
              />
            </label>
            <div className="student-checklist">
              {students.map((s) => (
                <label key={s.id}>
                  <Checkbox
                    checked={editGroup.studentIds.includes(s.id)}
                    onCheckedChange={(v) =>
                      setEditGroup({
                        ...editGroup,
                        studentIds: v
                          ? [...editGroup.studentIds, s.id]
                          : editGroup.studentIds.filter((id) => id !== s.id),
                      })
                    }
                  />
                  <Avatar student={s} size="small" />
                  {s.name}
                </label>
              ))}
            </div>
            <Action
              disabled={busy || !editGroup.name.trim()}
              onClick={async () => {
                if (
                  await save(
                    {
                      ...w,
                      groups: w.groups.map((g) =>
                        g.id === editGroup.id ? editGroup : g,
                      ),
                    },
                    "Your group is updated",
                  )
                )
                  setEditGroup(null);
              }}
            >
              Save group
              <Check size={16} />
            </Action>
          </div>
        )}
      </Modal>
    </>
  );
}

export function StudentsView() {
  const { w, students, classroom, catalog, save, busy, go } = useTeacher();
  const params = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All students"),
    [view, setView] = useState("students"),
    [focus, setFocus] = useState(catalog[0]?.code || ""),
    [add, setAdd] = useState(false),
    [names, setNames] = useState(""),
    [evidenceOpen, setEvidenceOpen] = useState(false),
    [score, setScore] = useState(""),
    [source, setSource] = useState("Exit ticket"),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [note, setNote] = useState("");
  useEffect(() => {
    setSelected(params.get("id"));
    if (params.get("standard")) setFocus(params.get("standard")!);
  }, [params]);
  const student = students.find((s) => s.id === selected);
  useEffect(() => setNote(student?.notes || ""), [student?.id]);
  const filtered = students.filter(
    (s) =>
      s.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "All students" ||
        (filter === "Needs support" &&
          catalog.some((c) => (mastery(s, c.code) ?? 100) < 65)) ||
        (filter === "Ready for enrichment" &&
          catalog.length &&
          catalog.every((c) => masteryStatus(s, c.code) === "Mastered"))),
  );
  const bands = performanceBands(students, catalog);
  const gapGroups = sharedGapGroups(students, catalog);
  async function addStudents(fromRoster?: string[]) {
    const list = (
      fromRoster ||
      names.split(/[\n,]/)
    )
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 100);
    if (!list.length) return;
    const next = list.map((name, i) => ({
      id: crypto.randomUUID(),
      classId: classroom.id,
      name: name.slice(0, 80),
      color: classroomColors[(students.length + i) % 6],
      evidence: [],
      notes: "",
    }));
    if (
      await save(
        { ...w, students: [...w.students, ...next] },
        next.length + " students added",
      )
    ) {
      setAdd(false);
      setNames("");
    }
  }
  async function recordEvidence() {
    if (
      !student ||
      !focus ||
      !source.trim() ||
      score === "" ||
      Number(score) < 0 ||
      Number(score) > 100
    )
      return;
    const e = {
      id: crypto.randomUUID(),
      standard: focus,
      score: Number(score),
      date,
      source: source.trim(),
    };
    if (
      await save(
        {
          ...w,
          students: w.students.map((s) =>
            s.id === student.id ? { ...s, evidence: [...s.evidence, e] } : s,
          ),
        },
        "A new piece of the learning picture is saved",
      )
    ) {
      setEvidenceOpen(false);
      setScore("");
    }
  }
  const history =
    student?.evidence
      .filter((e) => e.standard === focus)
      .sort((a, b) => a.date.localeCompare(b.date)) || [];
  return (
    <>
      {student ? (
        <>
          <button className="back-link" onClick={() => go("/students")}>
            ← All students
          </button>
          <div className="student-profile-heading">
            <Avatar student={student} size="large" />
            <div>
              <span className="eyebrow">EVERY LEARNER HAS A STORY</span>
              <h1>{student.name}</h1>
              <p>
                {classroom.name} · Grade {classroom.grade}
                {classroom.demo ? " · Fictional student" : ""}
              </p>
            </div>
            <Action
              onClick={() => setEvidenceOpen(true)}
              disabled={!catalog.length}
            >
              <Plus size={17} />
              Record evidence
            </Action>
          </div>
          <div className="profile-layout">
            <section className="panel">
              <SectionTitle
                title="Evidence by standard"
                description="Progress across skills, built from multiple observations."
              />
              {["Math", "ELA"].map((subject) => (
                <div className="profile-subject" key={subject}>
                  <span className="eyebrow">
                    {subject === "Math"
                      ? "MATHEMATICS"
                      : "ENGLISH LANGUAGE ARTS"}
                  </span>
                  {catalog
                    .filter((s) => s.subject === subject)
                    .map((s) => (
                      <button
                        key={s.code}
                        className={
                          "mastery-standard " +
                          (focus === s.code ? "active" : "")
                        }
                        onClick={() => setFocus(s.code)}
                      >
                        <div>
                          <strong>{s.title}</strong>
                          <span>
                            {s.code} ·{" "}
                            {
                              student.evidence.filter(
                                (e) => e.standard === s.code,
                              ).length
                            }{" "}
                            evidence records
                          </span>
                        </div>
                        <Score value={mastery(student, s.code)} />
                        <span className="mastery-status">
                          {masteryStatus(student, s.code)}
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                </div>
              ))}
            </section>
            <section className="panel trajectory-panel">
              <SectionTitle
                title="Progress over time"
                description={catalog.find((s) => s.code === focus)?.title}
              />
              <div className="trajectory-stat">
                <strong>
                  {mastery(student, focus) ?? "—"}
                  <span>%</span>
                </strong>
                <Pill
                  tone={
                    masteryStatus(student, focus) === "Mastered"
                      ? "green"
                      : "amber"
                  }
                >
                  {masteryStatus(student, focus)}
                </Pill>
              </div>
              {history.length ? (
                <>
                  <div
                    className="evidence-bars"
                    role="img"
                    aria-label={history
                      .map((e) => e.source + ": " + e.score + " percent")
                      .join("; ")}
                  >
                    {history.slice(-6).map((e) => (
                      <div key={e.id}>
                        <span>{e.score}%</span>
                        <i
                          style={{ height: Math.max(8, e.score * 1.2) + "px" }}
                        />
                        <small>
                          {new Date(e.date + "T12:00:00").toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric" },
                          )}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div className="evidence-list">
                    {[...history]
                      .reverse()
                      .slice(0, 8)
                      .map((e) => (
                        <div key={e.id}>
                          <span>
                            <strong>{e.source}</strong>
                            <small>{e.date}</small>
                          </span>
                          <Score value={e.score} />
                        </div>
                      ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  title="Start their learning story"
                  description="Add a check-in or verified assessment response."
                />
              )}
              <p className="method-note">
                Mastery requires three or more records and an average of at
                least 80% across the three latest.
              </p>
            </section>
          </div>
          <div className="panel teacher-notes">
            <SectionTitle
              title="What you’re noticing"
              description="Your observations add context the numbers can’t."
            />
            <textarea
              aria-label="Teacher observations"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What helped? What would you like to try next?"
            />
            <Action
              variant="secondary"
              disabled={busy || note === student.notes}
              onClick={() =>
                save(
                  {
                    ...w,
                    students: w.students.map((s) =>
                      s.id === student.id ? { ...s, notes: note } : s,
                    ),
                  },
                  "Observation saved",
                )
              }
            >
              Save observation
              <Check size={16} />
            </Action>
          </div>
        </>
      ) : (
        <>
          <button className="back-link" onClick={() => go("/classes")}>
            ← All classes
          </button>
          <PageTitle
            eyebrow="SEE THE LEARNER BEHIND THE NUMBER"
            title={classroom.name}
            description={
              (classroom.grade === 0 ? "Kindergarten" : "Grade " + classroom.grade) +
              " · " +
              frameworkLabel(classroom.framework) +
              " · " +
              students.length +
              (students.length === 1 ? " student" : " students")
            }
          >
            <Action onClick={() => setAdd(true)}>
              <Plus size={17} />
              Add students
            </Action>
          </PageTitle>
          <div
            className="student-view-switch"
            role="group"
            aria-label="Student mastery view"
          >
            {[
              ["students", "Students"],
              ["levels", "High / Mid / Low"],
              ["standards", "Shared skill gaps"],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "students" && (
            <>
              <div className="filter-bar">
                <label className="search-box">
                  <Search size={17} />
                  <input
                    value={query}
                    aria-label="Find a student"
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a student…"
                  />
                </label>
                <Pick
                  label="Student support filter"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    "All students",
                    "Needs support",
                    "Ready for enrichment",
                  ]}
                />
                <Action
                  variant="secondary small"
                  onClick={() =>
                    downloadText(
                      "student-mastery.csv",
                      "Student," +
                        catalog.map((s) => s.code).join(",") +
                        "\n" +
                        students
                          .map(
                            (s) =>
                              '"' +
                              s.name.replace(/"/g, '""') +
                              '",' +
                              catalog
                                .map((c) => mastery(s, c.code) ?? "")
                                .join(","),
                          )
                          .join("\n"),
                      "text/csv",
                    )
                  }
                >
                  <Download size={15} />
                  Export
                </Action>
              </div>
              <div className="student-grid">
                {filtered.map((s) => {
                  const mastered = catalog.filter(
                    (c) => masteryStatus(s, c.code) === "Mastered",
                  ).length;
                  const weak = catalog
                    .map((c) => ({ s: c, m: mastery(s, c.code) }))
                    .filter(
                      (x): x is { s: Standard; m: number } => x.m !== null,
                    )
                    .sort((a, b) => a.m - b.m)[0];
                  return (
                    <button
                      className="panel student-card"
                      key={s.id}
                      onClick={() => go("/students?id=" + s.id)}
                    >
                      <div>
                        <Avatar student={s} />
                        <ArrowUpRight size={18} />
                      </div>
                      <h2>{s.name}</h2>
                      <p>{s.evidence.length} evidence records</p>
                      <div className="mastery-blocks">
                        {catalog.map((c) => (
                          <span
                            key={c.code}
                            title={c.title + ": " + masteryStatus(s, c.code)}
                            className={
                              masteryStatus(s, c.code) === "Mastered"
                                ? "good"
                                : (mastery(s, c.code) ?? 100) < 65
                                  ? "low"
                                  : mastery(s, c.code) === null
                                    ? "unknown"
                                    : "medium"
                            }
                          />
                        ))}
                      </div>
                      <div className="student-card-footer">
                        <strong>
                          {mastered}
                          <span> / {catalog.length} skills mastered</span>
                        </strong>
                        <span>
                          {weak && weak.m < 70
                            ? "Next: " + weak.s.title
                            : weak
                              ? "Keep the curiosity growing"
                              : "Ready for the first check-in"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {!filtered.length && (
                <EmptyState
                  title={
                    query ? "No students found" : "A space for every learner"
                  }
                  description="Add student aliases individually or paste a roster."
                >
                  <Action onClick={() => setAdd(true)}>
                    Add students
                    <Plus size={16} />
                  </Action>
                </EmptyState>
              )}
            </>
          )}
          {view === "levels" && (
            <div className="student-groups-grid">
              {bands.map((band) => (
                <section
                  className={`panel student-group-card ${band.id}`}
                  key={band.id}
                >
                  <header>
                    <span className="group-icon">
                      <Layers size={21} />
                    </span>
                    <Pill>{band.range}</Pill>
                  </header>
                  <h2>{band.name}</h2>
                  <p>{band.description}</p>
                  <div className="group-members">
                    {band.students.map((member) => (
                      <button
                        key={member.id}
                        onClick={() => go("/students?id=" + member.id)}
                      >
                        <Avatar student={member} size="small" />
                        <span>{member.name}</span>
                        <Score value={studentOverall(member, catalog)} />
                      </button>
                    ))}
                    {!band.students.length && (
                      <span className="field-help">
                        No students in this level right now.
                      </span>
                    )}
                  </div>
                </section>
              ))}
              <p className="method-note group-method-note">
                These flexible groups use each student’s average across
                standards with current evidence. Recheck them after new work is
                confirmed.
              </p>
            </div>
          )}
          {view === "standards" &&
            (gapGroups.length ? (
              <div className="student-groups-grid skill-gap-groups">
                {gapGroups.map((group) => (
                  <section
                    className="panel student-group-card skill"
                    key={group.standard.code}
                  >
                    <header>
                      <span className="group-icon">
                        <Target size={21} />
                      </span>
                      <Pill
                        tone={
                          group.instruction === "Whole class"
                            ? "amber"
                            : "neutral"
                        }
                      >
                        {group.instruction}
                      </Pill>
                    </header>
                    <h2>{group.standard.title}</h2>
                    <p>
                      {group.standard.code} · {group.average}% group average
                    </p>
                    <div className="group-members">
                      {group.students.map((member) => (
                        <button
                          key={member.id}
                          onClick={() =>
                            go(
                              "/students?id=" +
                                member.id +
                                "&standard=" +
                                group.standard.code,
                            )
                          }
                        >
                          <Avatar student={member} size="small" />
                          <span>{member.name}</span>
                          <Score value={mastery(member, group.standard.code)} />
                        </button>
                      ))}
                    </div>
                    <Action
                      variant="secondary small"
                      onClick={() =>
                        go(
                          "/lessons?standard=" +
                            encodeURIComponent(group.standard.code) +
                            "&students=" +
                            group.students
                              .map((member) => member.id)
                              .join(",") +
                            "&framework=" +
                            encodeURIComponent(group.standard.framework) +
                            "&grade=" +
                            group.standard.grade,
                        )
                      }
                    >
                      <BookOpen size={15} />
                      Plan {group.instruction.toLowerCase()} reteach
                    </Action>
                  </section>
                ))}
                <p className="method-note group-method-note">
                  Shared-gap groups include students below 70% on the same
                  standard. A whole-class suggestion appears when at least half
                  the class shares that gap.
                </p>
              </div>
            ) : (
              <EmptyState
                title="No shared skill gaps yet"
                description="Confirm more student work to identify standards that several students need to revisit."
              />
            ))}
        </>
      )}
      <Modal
        open={add}
        onClose={() => setAdd(false)}
        title="Meet your learners"
        description="Photograph a roster, or type names with each student on a new line."
      >
        <div className="form-stack">
          <RosterScanner
            onAdd={(list) => addStudents(list)}
          />
          <label>
            Or type student names or aliases
            <textarea
              value={names}
              className="question-paste"
              onChange={(e) => setNames(e.target.value)}
              placeholder={"Amelia R.\nBenjamin L.\nChloe M."}
            />
          </label>
          <Action disabled={busy || !names.trim()} onClick={() => addStudents()}>
            Add to classroom
            <ArrowRight size={16} />
          </Action>
        </div>
      </Modal>
      <Modal
        open={evidenceOpen}
        onClose={() => setEvidenceOpen(false)}
        title="Another piece of the picture"
        description={
          "Record an observation of " +
          (student?.name || "your student") +
          "’s understanding."
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            recordEvidence();
          }}
          className="form-stack"
        >
          <label>
            Standard
            <Pick
              label="Evidence standard"
              value={focus}
              onChange={setFocus}
              options={catalog.map((s) => ({
                value: s.code,
                label: s.code + " · " + s.title,
              }))}
            />
          </label>
          <label>
            Source
            <input
              required
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. Exit ticket · Area models"
            />
          </label>
          <div className="form-grid">
            <label>
              Score (%)
              <input
                required
                type="number"
                min={0}
                max={100}
                step={1}
                value={score}
                onChange={(e) => setScore(e.target.value)}
              />
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>
          <Action type="submit" disabled={busy}>
            Record evidence
            <Check size={16} />
          </Action>
        </form>
      </Modal>
    </>
  );
}
