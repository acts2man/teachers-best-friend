"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { analyzeRequest } from "@/lib/analyze-client";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
  Check,
  Clock,
  Lightbulb,
  Eye,
  Hand,
  Headphones,
  Printer,
  Download,
  CalendarDays,
  BookOpen,
  Dices,
  Play,
  Pause,
  RotateCcw,
  Search,
  Upload,
  FileText,
  ShieldCheck,
  Trash2,
  Settings,
  Target,
  LoaderCircle,
  CheckCircle2,
  Users,
  Pencil,
  Sparkles,
  Undo2,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useTeacher } from "./teacher-context";
import {
  PageTitle,
  SectionTitle,
  Action,
  Pick,
  Pill,
  Avatar,
  AvatarStack,
  EmptyState,
  Insight,
  Modal,
  TextLink,
  printContent,
  downloadText,
} from "./teacher-shared";
import { catalogFor } from "@/lib/teacher-catalog";
import {
  hasCuratedLesson,
  lessonContent,
  adaptations,
  resourceCatalog,
  type LessonContent,
} from "@/lib/teacher-lessons";
import { priorities } from "@/lib/teacher-data";
import { themes, themeById } from "@/lib/themes";
import type { Lesson, Resource, Student, Standard } from "@/lib/teacher-types";

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
export function AreaModel() {
  const [n, setN] = useState(23),
    [factor, setFactor] = useState(4),
    [step, setStep] = useState(3),
    [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(
      () =>
        setStep((s) => {
          if (s >= 3) {
            setPlaying(false);
            return 3;
          }
          return s + 1;
        }),
      1400,
    );
    return () => clearInterval(id);
  }, [playing]);
  const tens = Math.floor(n / 10) * 10,
    ones = n % 10;
  return (
    <div className="area-model">
      <div className="area-model-header">
        <div>
          <span className="eyebrow">SEE THE THINKING</span>
          <h3>One product. Two useful parts.</h3>
        </div>
        <button
          className="icon-button"
          aria-label="Restart the area model"
          onClick={() => {
            setStep(0);
            setPlaying(true);
          }}
        >
          <RotateCcw size={17} />
        </button>
      </div>
      <div className="model-equation">
        {n} <span>×</span> {factor} <span>=</span>{" "}
        <strong>{step === 3 ? n * factor : "?"}</strong>
      </div>
      <div className="model-diagram">
        <span className="factor-label">{factor}</span>
        <div
          className="model-sections"
          style={{
            gridTemplateColumns: tens + "fr " + Math.max(ones, 1) + "fr",
          }}
        >
          <div className={"tens-region " + (step >= 1 ? "reveal" : "")}>
            <span>{tens}</span>
            <strong>
              {step >= 1 ? tens + " × " + factor : "Tens"}
              <small>{step >= 2 ? "= " + tens * factor : ""}</small>
            </strong>
          </div>
          <div className={"ones-region " + (step >= 1 ? "reveal" : "")}>
            <span>{ones}</span>
            <strong>
              {step >= 1 ? ones + " × " + factor : "Ones"}
              <small>{step >= 2 ? "= " + ones * factor : ""}</small>
            </strong>
          </div>
        </div>
        <p className="model-result">
          {step === 0
            ? "First, split the number into tens and ones."
            : step === 1
              ? "Multiply each part by the same factor."
              : step === 2
                ? "Now combine your partial products."
                : tens * factor + " + " + ones * factor + " = " + n * factor}
        </p>
        <div className="model-controls">
          <label>
            Number <strong>{n}</strong>
            <Slider
              aria-label="Number to multiply"
              value={[n]}
              min={11}
              max={49}
              step={1}
              onValueChange={(v) => {
                setN(v[0]);
                setStep(3);
              }}
            />
          </label>
          <label>
            Groups <strong>{factor}</strong>
            <Slider
              aria-label="Number of groups"
              value={[factor]}
              min={2}
              max={9}
              step={1}
              onValueChange={(v) => {
                setFactor(v[0]);
                setStep(3);
              }}
            />
          </label>
          <Action
            variant="secondary small"
            onClick={() => {
              if (playing) setPlaying(false);
              else {
                setStep(0);
                setPlaying(true);
              }
            }}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}{" "}
            {playing ? "Pause" : "Walk me through it"}
          </Action>
        </div>
      </div>
    </div>
  );
}

export function ReteachView() {
  const { w, classroom, students, save, busy, aiReady, go } = useTeacher();
  const params = useSearchParams(),
    savedPlan = w.lessons.find((l) => l.id === params.get("lesson")),
    sourceAssessment = w.assessments.find(
      (a) => a.id === (params.get("assessment") || savedPlan?.assessmentId),
    ),
    contextGrade =
      sourceAssessment?.grade ??
      savedPlan?.grade ??
      (params.has("grade") ? Number(params.get("grade")) : classroom.grade),
    contextFramework =
      sourceAssessment?.framework ||
      savedPlan?.framework ||
      params.get("framework") ||
      classroom.framework,
    catalog = catalogFor(w, contextGrade, contextFramework);
  const [audience, setAudience] = useState(params.get("student") || ""),
    [standard, setStandard] = useState(params.get("standard") || ""),
    [modality, setModality] = useState("Visual"),
    [duration, setDuration] = useState("15"),
    [tab, setTab] = useState("build"),
    [lessonTab, setLessonTab] = useState("visual"),
    [edited, setEdited] = useState(false),
    [editing, setEditing] = useState(false),
    [notes, setNotes] = useState(""),
    [date, setDate] = useState(tomorrow()),
    [custom, setCustom] = useState<Lesson["custom"]>(),
    [aiBusy, setAiBusy] = useState(false),
    [savedId, setSavedId] = useState<string | null>(null),
    [checkLesson, setCheckLesson] = useState<Lesson | null>(null),
    [exitScores, setExitScores] = useState<Record<string, string>>({}),
    [answerKeys, setAnswerKeys] = useState(false),
    [deleteId, setDeleteId] = useState<string | null>(null);
  const suggestedIds = (params.get("students") || "")
    .split(",")
    .filter((id) => students.some((student) => student.id === id));
  const plans = w.lessons.filter((l) => l.classId === classroom.id),
    s = catalog.find((s) => s.code === standard);
  useEffect(() => {
    const l = params.get("lesson"),
      st = params.get("standard");
    if (l) {
      const p = w.lessons.find((p) => p.id === l);
      if (p) {
        setAudience(p.studentIds.length > 1 ? "saved" : p.studentIds[0] || "");
        setStandard(p.standard);
        setModality(p.modality);
        setDuration(String(p.duration));
        setNotes(p.notes);
        setDate(p.date);
        setCustom(p.custom);
        setSavedId(p.id);
        setEdited(p.origin === "edited");
        setEditing(false);
      }
    } else if (st) {
      setStandard(st);
      setCustom(undefined);
      setSavedId(null);
      setEdited(false);
      setEditing(false);
      const student = params.get("student"),
        groupIds = (params.get("students") || "").split(",").filter(Boolean);
      setAudience(groupIds.length ? "suggested" : student || "");
      setNotes("");
      const observed = sourceAssessment?.responses
        .filter(
          (r) =>
            (r.studentId === student || groupIds.includes(r.studentId)) &&
            r.verified &&
            !r.correct &&
            sourceAssessment.questions.some(
              (q) => q.id === r.questionId && q.standard === st,
            ),
        )
        .map((r) => r.misconception)
        .filter(Boolean);
      if (observed?.length) setNotes([...new Set(observed)].join("\n"));
    } else {
      setStandard("");
      setAudience("");
      setCustom(undefined);
      setSavedId(null);
      setNotes("");
      setEdited(false);
      setEditing(false);
    }
    setTab(params.get("tab") === "plan" ? "plan" : "build");
  }, [params, savedPlan?.id, sourceAssessment?.id]);
  const modalityLabel = modality === "Kinesthetic" ? "Hands-on" : modality;
  const content = s
      ? custom || (hasCuratedLesson(s) ? lessonContent(s) : null)
      : null,
    group =
      audience === "saved"
        ? students.filter((st) => savedPlan?.studentIds.includes(st.id))
        : audience === "suggested"
          ? students.filter((st) => suggestedIds.includes(st.id))
          : students.filter((st) => st.id === audience);
  function printLesson(practiceOnly = false) {
    if (!s || !content) return;
    const material = practiceOnly
      ? content.practice
          .map(
            (q, i) =>
              i +
              1 +
              ". " +
              q.q +
              (answerKeys ? "\nAnswer: " + q.a : "") +
              "\n\n",
          )
          .join("\n")
      : s.code +
        " · " +
        duration +
        " minutes · " +
        modality +
        "\n\nGOAL\n" +
        content.objective +
        "\n\nMATERIALS\n" +
        content.materials.join(", ") +
        "\n\n" +
        content.phases
          .map(
            (p, i) =>
              (custom
                ? p.time
                : Math.round(([0, 2, 5, 9, 12][i] * Number(duration)) / 15) +
                  "–" +
                  Math.round(([2, 5, 9, 12, 15][i] * Number(duration)) / 15)) +
              " MIN · " +
              p.name.toUpperCase() +
              "\n" +
              p.text,
          )
          .join("\n\n") +
        "\n\n" +
        modality.toUpperCase() +
        " APPROACH\n" +
        adaptations[modality] +
        "\n\nPRACTICE\n" +
        content.practice
          .map((q, i) => i + 1 + ". " + q.q + "\nTeacher key: " + q.a)
          .join("\n\n") +
        "\n\nEXIT TICKET\n" +
        content.exit
          .map((q, i) => i + 1 + ". " + q.q + "\nTeacher key: " + q.a)
          .join("\n\n") +
        "\n\nTEACHER NOTES\n" +
        notes;
    printContent((practiceOnly ? "Practice · " : "") + s.title, material);
  }
  async function saveLesson() {
    if (!s || !content || !group.length) return;
    const lesson: Lesson = {
      id: savedId || crypto.randomUUID(),
      classId: classroom.id,
      framework: contextFramework,
      grade: contextGrade,
      assessmentId: sourceAssessment?.id,
      standard: s.code,
      title: s.title,
      duration: Number(duration),
      modality,
      notes,
      date,
      completed: false,
      studentIds: group.map((s) => s.id),
      origin: custom ? (edited ? "edited" : "ai") : "template",
      ...(custom ? { custom } : {}),
    };
    if (
      await save(
        {
          ...w,
          lessons: savedId
            ? w.lessons.map((l) => (l.id === savedId ? lesson : l))
            : [lesson, ...w.lessons],
        },
        "Your lesson is on the teaching plan",
      )
    ) {
      setSavedId(lesson.id);
      setTab("plan");
    }
  }
  async function generateAI() {
    if (!s || !aiReady) return;
    setAiBusy(true);
    try {
      const d = await analyzeRequest({
        mode: "lesson",
        standard: s.code,
        duration: Number(duration),
        modality,
        text: notes,
        framework: contextFramework,
        grade: contextGrade,
      });
      setCustom(d.result);
      setEdited(false);
      setEditing(false);
      setLessonTab("lesson");
      toast.success(
        "Your lesson plan is ready. Review it, edit anything, then save it.",
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "The lesson couldn’t be created.",
      );
    } finally {
      setAiBusy(false);
    }
  }
  async function recordExit() {
    if (!checkLesson) return;
    const scored = Object.entries(exitScores).filter(([, v]) => v !== "");
    if (!scored.length) return;
    const next = w.students.map((s) => {
      const value = exitScores[s.id];
      if (value === undefined || value === "") return s;
      const id = "exit-" + checkLesson.id + "-" + s.id;
      return {
        ...s,
        evidence: [
          ...s.evidence.filter((e) => e.id !== id),
          {
            id,
            standard: checkLesson.standard,
            score: Number(value) * 50,
            date: new Date().toISOString().slice(0, 10),
            source: "Exit ticket · " + checkLesson.title,
          },
        ],
      };
    });
    if (
      await save(
        {
          ...w,
          students: next,
          lessons: w.lessons.map((l) =>
            l.id === checkLesson.id ? { ...l, completed: true } : l,
          ),
        },
        "Exit ticket recorded. Your mastery picture is updated.",
      )
    ) {
      setCheckLesson(null);
      setExitScores({});
    }
  }
  function reset(st: string) {
    setStandard(st);
    setCustom(undefined);
    setSavedId(null);
    setNotes("");
    setEdited(false);
    setEditing(false);
  }
  return (
    <>
      <PageTitle
        eyebrow="FROM “NOW WHAT?” TO “I’VE GOT THIS.”"
        title="Lesson plans"
        description="Choose a different way to teach the skill, generate the plan, and keep it here."
      >
        <Action variant="secondary" onClick={() => setTab("plan")}>
          <CalendarDays size={16} />
          Saved lesson plans<Pill>{plans.length}</Pill>
        </Action>
      </PageTitle>
      {(sourceAssessment || group.length > 1) && (
        <div className="reteach-context">
          <BookOpen size={21} />
          <div>
            <strong>
              {group.length > 1
                ? group.length + " students"
                : group[0]?.name || "Student support"}{" "}
              · {s?.title || standard}
            </strong>
            <p>
              {sourceAssessment
                ? "Student work from " + sourceAssessment.title
                : "Flexible group based on a shared standard gap"}
            </p>
          </div>
          {sourceAssessment && (
            <button
              className="text-link"
              onClick={() =>
                go(
                  "/assessments?id=" +
                    sourceAssessment.id +
                    "&tab=responses&student=" +
                    (group[0]?.id || audience),
                )
              }
            >
              Back to student work
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="page-tabs">
          <TabsTrigger value="build">Build a reteach lesson</TabsTrigger>
          <TabsTrigger value="plan">
            Saved lesson plans <span>{plans.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="build">
          {s && content ? (
            <div className="studio-layout">
              <aside className="studio-controls panel">
                <span className="studio-icon">
                  <Lightbulb size={27} />
                </span>
                <h2>A focused teaching plan</h2>
                <p>Match the approach to the gap you observed.</p>
                <div className="form-stack">
                  <label>
                    Student
                    <Pick
                      label="Student for this reteach plan"
                      value={audience}
                      onChange={setAudience}
                      options={[
                        { value: "", label: "Choose a student" },
                        ...(suggestedIds.length
                          ? [
                              {
                                value: "suggested",
                                label: `Suggested group · ${suggestedIds.length} students`,
                              },
                            ]
                          : []),
                        ...(savedPlan && savedPlan.studentIds.length > 1
                          ? [
                              {
                                value: "saved",
                                label:
                                  "Saved group · " +
                                  savedPlan.studentIds.length +
                                  " students",
                              },
                            ]
                          : []),
                        ...students.map((st) => ({
                          value: st.id,
                          label: st.name,
                        })),
                      ]}
                    />
                  </label>
                  <label>
                    Focus skill
                    <Pick
                      value={standard}
                      onChange={reset}
                      label="Reteach standard"
                      options={catalog.map((s) => ({
                        value: s.code,
                        label: s.title,
                      }))}
                    />
                  </label>
                  <label>
                    Time together
                    <Pick
                      value={duration}
                      onChange={setDuration}
                      label="Lesson duration"
                      options={["10", "15", "20"].map((v) => ({
                        value: v,
                        label: v + " minutes",
                      }))}
                    />
                  </label>
                  <label>Teaching approach</label>
                  <Tabs value={modality} onValueChange={setModality}>
                    <TabsList className="modality-tabs">
                      <TabsTrigger value="Visual">
                        <Eye size={18} />
                        Visual
                      </TabsTrigger>
                      <TabsTrigger value="Kinesthetic">
                        <Hand size={18} />
                        Hands-on
                      </TabsTrigger>
                      <TabsTrigger value="Auditory">
                        <Headphones size={18} />
                        Auditory
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <label>
                    Teaching date
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <div className="lesson-audience">
                    <span className="eyebrow">WHO IT’S FOR</span>
                    <AvatarStack students={group} />
                    <span>
                      {group.length === 1
                        ? group[0].name
                        : group.length
                          ? group.length + " students in saved plan"
                          : "Choose the student this plan will support"}
                    </span>
                  </div>
                  <label>
                    Your teaching notes
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="A helpful example, a student observation, or a reminder…"
                    />
                  </label>
                  <Action
                    onClick={saveLesson}
                    disabled={busy || !date || !group.length}
                  >
                    <Plus size={16} />
                    {savedId ? "Update saved plan" : "Save to lesson plans"}
                  </Action>
                  <span className="field-help">
                    Below the plan, generate an AI lesson built around the
                    approach you chose.
                  </span>
                </div>
              </aside>
              <div className="lesson-workspace">
                <div className="lesson-heading">
                  <div>
                    <Pill tone="green">{s.code}</Pill>
                    <Pill>
                      {custom
                        ? edited
                          ? "Edited lesson · Saved with your changes"
                          : "AI lesson plan · Review before teaching"
                        : "Prepared lesson · Editable"}
                    </Pill>
                    <h2>{s.title}</h2>
                    <p>{content.objective}</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Print lesson"
                    onClick={() => printLesson()}
                  >
                    <Printer size={20} />
                  </button>
                </div>
                <div className="editor-bar">
                  <span>
                    {editing
                      ? "Editing this plan. Your changes stay with the lesson when you save it."
                      : "This plan is editable. Change any phase, practice task, or exit question."}
                  </span>
                  <div>
                    {custom && hasCuratedLesson(s) && (
                      <Action
                        variant="secondary small"
                        disabled={aiBusy}
                        onClick={() => {
                          setCustom(undefined);
                          setEdited(false);
                          setEditing(false);
                        }}
                      >
                        <Undo2 size={14} />
                        Restore prepared lesson
                      </Action>
                    )}
                    <Action
                      variant={editing ? "small" : "secondary small"}
                      disabled={aiBusy}
                      onClick={() => {
                        if (!editing && !custom)
                          setCustom(structuredClone(content));
                        setEditing(!editing);
                      }}
                    >
                      {editing ? <Check size={14} /> : <Pencil size={14} />}
                      {editing ? "Done editing" : "Edit lesson"}
                    </Action>
                  </div>
                </div>
                {editing && custom ? (
                  <LessonEditor
                    content={custom}
                    onChange={(next) => {
                      setCustom(next);
                      setEdited(true);
                    }}
                  />
                ) : (
                <Tabs value={lessonTab} onValueChange={setLessonTab}>
                  <TabsList className="text-tabs">
                    <TabsTrigger value="visual">Teaching approach</TabsTrigger>
                    <TabsTrigger value="lesson">Lesson flow</TabsTrigger>
                    <TabsTrigger value="practice">
                      Targeted practice
                    </TabsTrigger>
                    <TabsTrigger value="exit">Exit ticket</TabsTrigger>
                  </TabsList>
                  <TabsContent value="lesson">
                    <div className="lesson-materials">
                      <BookOpen size={17} />
                      <span>
                        <strong>Bring along:</strong>{" "}
                        {content.materials.join(" · ")}
                      </span>
                    </div>
                    <div className="lesson-timeline">
                      {content.phases.map((p, i) => {
                        const boundaries = [0, 2, 5, 9, 12, 15].map((n) =>
                          Math.round((n * Number(duration)) / 15),
                        );
                        return (
                          <article key={p.name}>
                            <div className={"timeline-point c" + i}>
                              <span>{String(i + 1).padStart(2, "0")}</span>
                            </div>
                            <div className="timeline-content">
                              <div>
                                <h3>{p.name}</h3>
                                <span>
                                  <Clock size={13} />
                                  {custom
                                    ? p.time
                                    : boundaries[i] +
                                      "–" +
                                      boundaries[i + 1]}{" "}
                                  min
                                </span>
                              </div>
                              <p>{p.text}</p>
                              {i === 1 && s.code === "4.NBT.B.5" && (
                                <div className="equation-callout">
                                  <span>20 × 4 = 80</span>
                                  <Plus size={16} />
                                  <span>3 × 4 = 12</span>
                                  <strong>92</strong>
                                </div>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    <Insight>
                      Aim for a clear explanation, not just a correct answer.
                      That’s where the next teaching move becomes visible.
                    </Insight>
                  </TabsContent>
                  <TabsContent value="visual">
                    <div className="modality-intro">
                      <span className="soft-icon">
                        {modality === "Visual" ? (
                          <Eye size={24} />
                        ) : modality === "Kinesthetic" ? (
                          <Hand size={24} />
                        ) : (
                          <Headphones size={24} />
                        )}
                      </span>
                      <div>
                        <h3>
                          {modality === "Kinesthetic"
                            ? "Learning through doing"
                            : modality === "Auditory"
                              ? "Let the thinking be heard"
                              : "Make the thinking visible"}
                        </h3>
                        <p>{adaptations[modality]}</p>
                      </div>
                    </div>
                    {modality === "Visual" && s.code === "4.NBT.B.5" ? (
                      <AreaModel />
                    ) : (
                      <div className="adaptation-activity">
                        <span className="eyebrow">TRY IT TOGETHER</span>
                        <h3>
                          {modality === "Kinesthetic"
                            ? "Build, arrange, explain."
                            : modality === "Auditory"
                              ? "Think, tell, listen."
                              : "Notice, connect, explain."}
                        </h3>
                        <ol>
                          {(modality === "Kinesthetic"
                            ? [
                                "Write each step or supporting detail on a separate card.",
                                "Ask students to arrange the cards into a model or explanation.",
                                "Swap arrangements with a partner and justify one change.",
                              ]
                            : modality === "Auditory"
                              ? [
                                  "Read the task aloud without showing the numbers or answer choices.",
                                  "Have students explain what they know and what they need to find.",
                                  "Let a partner repeat the plan before either student writes.",
                                ]
                              : [
                                  "Highlight the question in one color and relevant evidence in another.",
                                  "Draw a bar model, area model, or idea-and-detail organizer.",
                                  "Connect each part of the visual to one sentence of reasoning.",
                                ]
                          ).map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ol>
                        <div className="practice-prompt">
                          {content.practice[0].q}
                        </div>
                      </div>
                    )}
                    <p className="method-note">
                      These are flexible instructional approaches, not fixed
                      labels for how a child learns.
                    </p>
                  </TabsContent>
                  <TabsContent value="practice">
                    <div className="practice-header">
                      <div>
                        <h3>A little scaffold. A little stretch.</h3>
                        <p>
                          Five tasks that progress from support to explanation.
                        </p>
                      </div>
                      <Action
                        variant="secondary small"
                        onClick={() => printLesson(true)}
                      >
                        <Printer size={15} />
                        Print practice
                      </Action>
                    </div>
                    <label className="switch-label">
                      <Switch
                        checked={answerKeys}
                        onCheckedChange={setAnswerKeys}
                      />
                      Show teacher answer key
                    </label>
                    <div className="practice-list">
                      {content.practice.map((p, i) => (
                        <article key={i}>
                          <span>{String(i + 1).padStart(2, "0")}</span>
                          <div>
                            <Pill>
                              {[
                                "Start here",
                                "Build confidence",
                                "Try independently",
                                "Apply it",
                                "Explain the thinking",
                              ][i] || "Practice"}
                            </Pill>
                            <p>{p.q}</p>
                            {answerKeys && (
                              <div className="answer-key">
                                <Check size={15} />
                                {p.a}
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  </TabsContent>
                  <TabsContent value="exit">
                    <div className="exit-intro">
                      <span className="soft-icon">
                        <Target size={25} />
                      </span>
                      <h3>Did it click?</h3>
                      <p>Two focused questions to see what changed.</p>
                    </div>
                    <div className="practice-list">
                      {content.exit.map((p, i) => (
                        <article key={i}>
                          <span>{i + 1}</span>
                          <div>
                            <p>{p.q}</p>
                            <details className="answer-detail">
                              <summary>Teacher answer key</summary>
                              <p>{p.a}</p>
                            </details>
                          </div>
                        </article>
                      ))}
                    </div>
                    <div className="exit-actions">
                      <Action
                        variant="secondary"
                        onClick={() =>
                          printContent(
                            s.title + " · Exit ticket",
                            "Name: __________________     Date: ______________\n\n" +
                              content.exit
                                .map((p, i) => i + 1 + ". " + p.q + "\n\n\n\n")
                                .join("\n"),
                          )
                        }
                      >
                        <Printer size={16} />
                        Print exit ticket
                      </Action>
                      <Action
                        onClick={async () => {
                          if (savedId) {
                            const lesson = w.lessons.find(
                              (l) => l.id === savedId,
                            );
                            if (lesson) setCheckLesson(lesson);
                          } else
                            toast.info(
                              "Add this lesson to your teaching plan first, then record results.",
                            );
                        }}
                      >
                        <Check size={16} />
                        Record results
                      </Action>
                    </div>
                  </TabsContent>
                </Tabs>
                )}
                <div className="ai-plan-cta">
                  <span className="soft-icon">
                    <Sparkles size={22} />
                  </span>
                  <div>
                    <h3>
                      Generate a {modalityLabel.toLowerCase()} lesson plan with
                      AI
                    </h3>
                    <p>
                      A complete {duration}-minute plan for {s.title} built
                      around the {modalityLabel.toLowerCase()} approach:
                      objective, materials, timed phases, five practice tasks,
                      and an exit ticket. Edit anything, then save it to your
                      lesson plans.
                    </p>
                  </div>
                  <div>
                    <Action
                      onClick={generateAI}
                      disabled={!aiReady || aiBusy || busy}
                    >
                      {aiBusy ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <Sparkles size={16} />
                      )}
                      {aiBusy ? "Building your plan…" : "Generate an AI lesson plan"}
                    </Action>
                    <Action
                      variant="secondary"
                      onClick={saveLesson}
                      disabled={busy || aiBusy || !date || !group.length}
                    >
                      <Plus size={16} />
                      {savedId ? "Update saved plan" : "Save to lesson plans"}
                    </Action>
                  </div>
                </div>
                {!aiReady && (
                  <p className="field-help">
                    Generating a plan needs the AI connection under Settings.
                    The lesson above can be edited and saved now.
                  </p>
                )}
                {!group.length && (
                  <p className="field-help">
                    Choose the student or group this plan is for before saving.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <ReteachStart
              standard={s}
              catalog={catalog}
              onChoose={reset}
              onGenerate={generateAI}
              creating={aiBusy}
              notes={notes}
              onNotes={setNotes}
              modality={modality}
              onModality={setModality}
              duration={duration}
              onDuration={setDuration}
            />
          )}
        </TabsContent>
        <TabsContent value="plan">
          {plans.length ? (
            <div className="saved-plans">
              {plans.map((l) => (
                <section
                  className={
                    "panel saved-plan " + (l.completed ? "completed" : "")
                  }
                  key={l.id}
                >
                  <span className="plan-date">
                    <CalendarDays size={19} />
                    {new Date(l.date + "T12:00:00").toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric" },
                    )}
                  </span>
                  <div>
                    <Pill tone={l.completed ? "green" : "neutral"}>
                      {l.completed ? "Taught & checked" : "Ready to teach"}
                    </Pill>
                    <h2>{l.title}</h2>
                    <p>
                      {l.standard} · {l.duration} minutes · {l.modality} ·{" "}
                      {l.studentIds.length} students
                    </p>
                    {l.notes && <p className="saved-note">{l.notes}</p>}
                  </div>
                  <div className="plan-card-actions">
                    <Action
                      variant="secondary small"
                      onClick={() => {
                        setTab("build");
                        go("/lessons?lesson=" + l.id);
                      }}
                    >
                      <Eye size={15} />
                      Open lesson
                    </Action>
                    <Action
                      variant="small"
                      onClick={() => {
                        setCheckLesson(l);
                        setExitScores({});
                      }}
                    >
                      <CheckCircle2 size={15} />
                      {l.completed ? "Update check" : "Record exit check"}
                    </Action>
                    <button
                      className="icon-button"
                      aria-label={"Remove lesson " + l.title}
                      onClick={() => setDeleteId(l.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState
              title="A little planning. A lot more clarity."
              description="Generate or build a reteach lesson and save it here. Your edits, notes, and teaching dates stay with each plan."
            >
              <Action onClick={() => setTab("build")}>
                Build your first lesson plan
                <ArrowRight size={16} />
              </Action>
            </EmptyState>
          )}
        </TabsContent>
      </Tabs>
      <Modal
        open={!!checkLesson}
        onClose={() => setCheckLesson(null)}
        title="Did the lesson make a difference?"
        description="Record how many of the two exit questions each student answered correctly. Leave unassessed students blank."
      >
        <div className="exit-score-list">
          {checkLesson?.studentIds
            .map((id) => students.find((s) => s.id === id))
            .filter((s): s is Student => !!s)
            .map((st) => (
              <div key={st.id}>
                <Avatar student={st} size="small" />
                <span>{st.name}</span>
                <Pick
                  label={"Exit result for " + st.name}
                  value={exitScores[st.id] ?? ""}
                  onChange={(v) => setExitScores({ ...exitScores, [st.id]: v })}
                  options={[
                    { value: "", label: "Not checked" },
                    { value: "0", label: "0 of 2" },
                    { value: "1", label: "1 of 2" },
                    { value: "2", label: "2 of 2" },
                  ]}
                />
              </div>
            ))}
        </div>
        <Action
          onClick={recordExit}
          disabled={busy || !Object.values(exitScores).some((v) => v !== "")}
        >
          Save results & update mastery
          <Check size={16} />
        </Action>
      </Modal>
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(v) => !v && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove this lesson from your plan?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Previously recorded student evidence will remain in their mastery
              history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep lesson</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                save(
                  { ...w, lessons: w.lessons.filter((l) => l.id !== deleteId) },
                  "Lesson removed",
                );
                setDeleteId(null);
              }}
            >
              Remove lesson
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ReteachStart({
  standard,
  catalog,
  onChoose,
  onGenerate,
  creating,
  notes,
  onNotes,
  modality,
  onModality,
  duration,
  onDuration,
}: {
  standard: Standard | undefined;
  catalog: Standard[];
  onChoose: (code: string) => void;
  onGenerate: () => void;
  creating: boolean;
  notes: string;
  onNotes: (value: string) => void;
  modality: string;
  onModality: (value: string) => void;
  duration: string;
  onDuration: (value: string) => void;
}) {
  const { assessments, students, aiReady, go } = useTeacher();
  const params = useSearchParams();
  const assessmentsWithNeeds = assessments.filter((assessment) =>
    assessment.responses.some(
      (response) => response.verified && !response.correct,
    ),
  );
  const [assessmentId, setAssessmentId] = useState(
    params.get("assessment") || assessmentsWithNeeds[0]?.id || "",
  );
  useEffect(() => {
    const requested = params.get("assessment");
    if (
      requested &&
      assessments.some((assessment) => assessment.id === requested)
    )
      setAssessmentId(requested);
    else if (!assessments.some((assessment) => assessment.id === assessmentId))
      setAssessmentId(assessmentsWithNeeds[0]?.id || "");
  }, [params, assessments.length]);
  const chosenAssessment = assessments.find(
    (assessment) => assessment.id === assessmentId,
  );
  const problemGroups = chosenAssessment
    ? chosenAssessment.questions
        .filter(
          (question) =>
            question.verified && !question.excluded && question.standard,
        )
        .map((question) => ({
          question,
          students: [
            ...new Set(
              chosenAssessment.responses
                .filter(
                  (response) =>
                    response.questionId === question.id &&
                    response.verified &&
                    !response.correct,
                )
                .map((response) => response.studentId),
            ),
          ],
        }))
        .filter((group) => group.students.length)
        .sort((a, b) => b.students.length - a.students.length)
    : [];
  const needs = assessments
    .flatMap((a) =>
      a.responses
        .filter((r) => r.verified && !r.correct)
        .map((r) => ({
          a,
          r,
          q: a.questions.find((q) => q.id === r.questionId),
          student: students.find((s) => s.id === r.studentId),
        })),
    )
    .filter((x) => x.q?.verified && !x.q.excluded && x.student);
  const seen = new Set<string>();
  const suggestions = needs
    .filter((x) => {
      const key = x.student!.id + "/" + x.q!.standard;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
  return (
    <div className="reteach-start">
      <section className="panel">
        <h2>
          {standard ? standard.title : "Start with an observed skill gap"}
        </h2>
        <p>
          {standard
            ? "Choose an approach for this standard, then generate a complete lesson plan from the standard and your observation."
            : "Open a student’s confirmed results to keep the reteaching connected to their work."}
        </p>
        {!standard && assessmentsWithNeeds.length > 0 && (
          <div className="assessment-reteach-picker">
            <label>
              Assessment
              <Pick
                label="Assessment with confirmed missed answers"
                value={assessmentId}
                onChange={setAssessmentId}
                options={assessmentsWithNeeds.map((assessment) => ({
                  value: assessment.id,
                  label: assessment.title,
                }))}
              />
            </label>
            <div className="assessment-problem-list">
              {problemGroups.map(({ question, students: studentIds }) => (
                <button
                  key={question.id}
                  onClick={() =>
                    go(
                      "/lessons?standard=" +
                        encodeURIComponent(question.standard) +
                        "&assessment=" +
                        assessmentId +
                        (studentIds.length === 1
                          ? "&student=" + studentIds[0]
                          : "&students=" + studentIds.join(",")),
                    )
                  }
                >
                  <span className="question-number">Q{question.number}</span>
                  <div>
                    <strong>{question.skill || question.standard}</strong>
                    <span>
                      {question.standard} · {studentIds.length}{" "}
                      {studentIds.length === 1 ? "student" : "students"} need
                      support
                    </span>
                  </div>
                  <ArrowRight size={16} />
                </button>
              ))}
            </div>
          </div>
        )}
        {!standard &&
          !assessmentsWithNeeds.length &&
          suggestions.map(({ a, q, student }) => (
            <button
              key={a.id + student!.id + q!.standard}
              className="saved-support-row"
              onClick={() =>
                go(
                  "/lessons?standard=" +
                    encodeURIComponent(q!.standard) +
                    "&student=" +
                    student!.id +
                    "&assessment=" +
                    a.id,
                )
              }
            >
              <Avatar student={student!} size="small" />
              <div>
                <strong>{student!.name}</strong>
                <span>
                  {q!.skill || q!.standard} · {a.title}
                </span>
              </div>
              <ArrowRight size={16} />
            </button>
          ))}
        {!standard && !assessmentsWithNeeds.length && !suggestions.length && (
          <Action onClick={() => go("/assessments")}>
            Review student work
            <ArrowRight size={16} />
          </Action>
        )}
        {standard && (
          <>
            <div className="available-approaches">
              {[
                ["Visual", Eye],
                ["Kinesthetic", Hand],
                ["Auditory", Headphones],
              ].map(([name, Icon]) => {
                const Glyph = Icon as typeof Eye;
                return (
                  <div key={name as string}>
                    <Glyph size={20} />
                    <h3>
                      {name === "Kinesthetic" ? "Hands-on" : (name as string)}
                    </h3>
                    <p>{adaptations[name as string]}</p>
                  </div>
                );
              })}
            </div>
            <div className="form-grid">
              <label>
                Teaching approach
                <Pick
                  label="Teaching approach"
                  value={modality}
                  onChange={onModality}
                  options={[
                    { value: "Visual", label: "Visual" },
                    { value: "Kinesthetic", label: "Hands-on" },
                    { value: "Auditory", label: "Auditory" },
                  ]}
                />
              </label>
              <label>
                Time together
                <Pick
                  label="Lesson duration"
                  value={duration}
                  onChange={onDuration}
                  options={["10", "15", "20"].map((v) => ({
                    value: v,
                    label: v + " minutes",
                  }))}
                />
              </label>
            </div>
            <label className="block-label">
              What did you notice in the student’s work?
              <textarea
                value={notes}
                onChange={(e) => onNotes(e.target.value)}
                placeholder="Describe the step or misunderstanding to focus on."
              />
            </label>
            <Action onClick={onGenerate} disabled={!aiReady || creating}>
              {creating ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Sparkles size={17} />
              )}
              {creating ? "Building your plan…" : "Generate an AI lesson plan"}
            </Action>
            {!aiReady && (
              <p className="field-help">
                This standard doesn’t have a prepared lesson yet. Connect AI to
                create one, or use a resource from your teaching library.
              </p>
            )}
            <TextLink
              onClick={() =>
                go("/resources?standard=" + encodeURIComponent(standard.code))
              }
            >
              Find or add a teaching resource
            </TextLink>
          </>
        )}
      </section>
      <section className="panel">
        <h2>Choose a focus directly</h2>
        <p>Pick the standard you want to revisit.</p>
        <Pick
          label="Choose a reteach focus"
          value={standard?.code || ""}
          onChange={onChoose}
          options={[
            { value: "", label: "Choose a standard" },
            ...catalog
              .filter((s) => !/not applicable/i.test(s.summary))
              .map((s) => ({ value: s.code, label: s.code + " · " + s.title })),
          ]}
        />
        <div className="reteach-library-link">
          <TextLink onClick={() => go("/resources")}>
            Browse teaching resources
          </TextLink>
        </div>
      </section>
    </div>
  );
}

function LessonEditor({
  content,
  onChange,
}: {
  content: LessonContent;
  onChange: (next: LessonContent) => void;
}) {
  // Materials are edited as one comma-separated line and committed on blur.
  const [materials, setMaterials] = useState(content.materials.join(", "));
  const update = (patch: Partial<LessonContent>) =>
    onChange({ ...content, ...patch });
  const pairs = (
    key: "practice" | "exit",
    title: string,
    addLabel: string,
  ) => (
    <div className="editor-group">
      <header>
        <h3>{title}</h3>
        <Action
          variant="secondary small"
          onClick={() => update({ [key]: [...content[key], { q: "", a: "" }] })}
        >
          <Plus size={14} />
          {addLabel}
        </Action>
      </header>
      {content[key].map((item, index) => (
        <div className="editor-row" key={index}>
          <span>{index + 1}</span>
          <div>
            <textarea
              aria-label={title + " question " + (index + 1)}
              value={item.q}
              placeholder="Question or task"
              onChange={(e) =>
                update({
                  [key]: content[key].map((x, i) =>
                    i === index ? { ...x, q: e.target.value } : x,
                  ),
                })
              }
            />
            <input
              aria-label={title + " answer " + (index + 1)}
              value={item.a}
              placeholder="Teacher answer key"
              onChange={(e) =>
                update({
                  [key]: content[key].map((x, i) =>
                    i === index ? { ...x, a: e.target.value } : x,
                  ),
                })
              }
            />
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={"Remove " + title.toLowerCase() + " item " + (index + 1)}
            disabled={content[key].length <= 1}
            onClick={() =>
              update({ [key]: content[key].filter((_, i) => i !== index) })
            }
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );
  return (
    <div className="lesson-editor">
      <label>
        Objective
        <textarea
          value={content.objective}
          onChange={(e) => update({ objective: e.target.value })}
        />
      </label>
      <label>
        Materials (separate with commas)
        <input
          value={materials}
          onChange={(e) => setMaterials(e.target.value)}
          onBlur={() =>
            update({
              materials: materials
                .split(",")
                .map((m) => m.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      <div className="editor-group">
        <header>
          <h3>Lesson phases</h3>
          <Action
            variant="secondary small"
            onClick={() =>
              update({
                phases: [
                  ...content.phases,
                  { time: "", name: "New phase", text: "" },
                ],
              })
            }
          >
            <Plus size={14} />
            Add phase
          </Action>
        </header>
        {content.phases.map((phase, index) => (
          <div className="editor-row" key={index}>
            <span>{index + 1}</span>
            <div>
              <div className="two">
                <input
                  aria-label={"Minutes for phase " + (index + 1)}
                  value={phase.time}
                  placeholder="0–2"
                  onChange={(e) =>
                    update({
                      phases: content.phases.map((x, i) =>
                        i === index ? { ...x, time: e.target.value } : x,
                      ),
                    })
                  }
                />
                <input
                  aria-label={"Name for phase " + (index + 1)}
                  value={phase.name}
                  placeholder="Phase name"
                  onChange={(e) =>
                    update({
                      phases: content.phases.map((x, i) =>
                        i === index ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
              <textarea
                aria-label={"Notes for phase " + (index + 1)}
                value={phase.text}
                placeholder="What you and the students do during this phase"
                onChange={(e) =>
                  update({
                    phases: content.phases.map((x, i) =>
                      i === index ? { ...x, text: e.target.value } : x,
                    ),
                  })
                }
              />
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={"Remove phase " + (index + 1)}
              disabled={content.phases.length <= 1}
              onClick={() =>
                update({ phases: content.phases.filter((_, i) => i !== index) })
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      {pairs("practice", "Targeted practice", "Add task")}
      {pairs("exit", "Exit ticket", "Add question")}
    </div>
  );
}

export function ResourcesView() {
  const { w, classroom, catalog, save, busy } = useTeacher(),
    params = useSearchParams();
  const [category, setCategory] = useState("All resources"),
    [query, setQuery] = useState(""),
    [detail, setDetail] = useState<Resource | null>(null),
    [add, setAdd] = useState(false),
    [title, setTitle] = useState(""),
    [standard, setStandard] = useState(catalog[0]?.code || ""),
    [content, setContent] = useState(""),
    [pages, setPages] = useState(""),
    [upload, setUpload] = useState<{ id: string; name: string } | null>(null),
    [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (params.get("category")) setCategory(params.get("category")!);
    if (params.get("standard")) setQuery(params.get("standard")!);
  }, [params]);
  const resources = [
      ...resourceCatalog(),
      ...w.resources.filter((r) => !r.classId || r.classId === classroom.id),
    ],
    filtered = resources.filter(
      (r) =>
        (category === "All resources" ||
          (category === "My curriculum" && r.uploadId) ||
          r.category === category) &&
        (r.title + " " + r.standard + " " + r.content)
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  const cats = [
    "All resources",
    "Watch",
    "Teach",
    "Practice",
    "Manipulative",
    "Game",
    "Intervention",
    "Enrichment",
    "My curriculum",
  ];
  async function uploadCurriculum(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const r = await fetch("/api/uploads", { method: "POST", body: form }),
        d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setUpload(d);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  async function addResource() {
    if (!title.trim()) return;
    if (
      await save(
        {
          ...w,
          resources: [
            {
              id: crypto.randomUUID(),
              classId: classroom.id,
              title: title.trim(),
              category: "My curriculum",
              standard,
              content: content.trim(),
              pages: pages.trim(),
              ...(upload ? { uploadId: upload.id } : {}),
            },
            ...w.resources,
          ],
        },
        "Your curriculum resource is saved",
      )
    ) {
      setAdd(false);
      setTitle("");
      setContent("");
      setUpload(null);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="A LITTLE INSPIRATION, RIGHT WHEN YOU NEED IT"
        title="Teaching resources"
        description="Find a resource for the standard and approach you’re working on."
      >
        <Action onClick={() => setAdd(true)}>
          <Upload size={17} />
          Add my curriculum
        </Action>
      </PageTitle>
      <div className="filter-bar">
        <label className="search-box">
          <Search size={17} />
          <input
            aria-label="Search teaching resources"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a skill, activity, or resource…"
          />
        </label>
        <Pick
          label="Resource category"
          value={category}
          onChange={setCategory}
          options={cats}
        />
        <span className="result-count">{filtered.length} resources</span>
      </div>
      <Tabs value={category} onValueChange={setCategory}>
        <TabsList className="resource-tabs">
          {cats.map((c) => (
            <TabsTrigger key={c} value={c}>
              {c}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="resources-grid">
        {filtered.map((r, i) => (
          <button
            className="panel resource-card"
            key={r.id}
            onClick={() => setDetail(r)}
          >
            <div className={"resource-art ra" + (i % 4)}>
              <span className="resource-art-label">
                {r.category.toUpperCase()}
              </span>
              <span className="resource-big-icon">
                {r.category === "Watch" ? (
                  <Play size={38} strokeWidth={1.3} />
                ) : r.category === "Game" ? (
                  <Dices size={38} strokeWidth={1.3} />
                ) : r.category === "Manipulative" ? (
                  <Hand size={38} strokeWidth={1.3} />
                ) : r.uploadId ? (
                  <FileText size={38} strokeWidth={1.3} />
                ) : (
                  <BookOpen size={38} strokeWidth={1.3} />
                )}
              </span>
              <div className="resource-art-footer">
                <span>
                  {r.uploadId
                    ? "YOUR CURRICULUM"
                    : "ORIGINAL TEACHING RESOURCE"}
                </span>
                <ArrowUpRight size={22} />
              </div>
            </div>
            <div className="resource-card-body">
              <Pill>{r.standard || "Flexible teaching"}</Pill>
              <h2>{r.title}</h2>
              <p>
                {r.content.slice(0, 110) ||
                  "Your uploaded curriculum, ready when you need it."}
                {r.content.length > 110 ? "…" : ""}
              </p>
              <span>
                {r.pages
                  ? "Pages " + r.pages
                  : r.category === "Watch"
                    ? "Interactive demonstration"
                    : "Ready to use in your classroom"}
              </span>
            </div>
          </button>
        ))}
      </div>
      {!filtered.length && (
        <EmptyState
          title="Let’s fill your toolkit"
          description="Try another category or add a curriculum resource of your own."
        >
          <Action onClick={() => setAdd(true)}>
            Add my curriculum
            <Plus size={16} />
          </Action>
        </EmptyState>
      )}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title || ""}
        description={
          (detail?.standard || "Flexible teaching") +
          " · " +
          (detail?.category || "")
        }
        wide
      >
        {detail && (
          <>
            {detail.category === "Watch" ? (
              <AreaModel />
            ) : (
              <div className="resource-content">
                {detail.content ||
                  "Open the attached document to use this resource."}
              </div>
            )}
            {detail.pages && (
              <Insight>
                Your saved curriculum reference: pages {detail.pages}. Confirm
                the edition and page numbers before teaching.
              </Insight>
            )}
            <div className="modal-actions">
              {detail.uploadId && (
                <a
                  className="action secondary"
                  href={"/api/uploads/" + detail.uploadId}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileText size={16} />
                  Open curriculum
                  <ArrowUpRight size={16} />
                </a>
              )}
              <Action
                variant="secondary"
                onClick={() =>
                  printContent(
                    detail.title,
                    detail.standard + "\n\n" + detail.content,
                  )
                }
              >
                <Printer size={16} />
                Print resource
              </Action>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={add}
        onClose={() => setAdd(false)}
        title="Your curriculum belongs here"
        description="Save the resource and tag its skill so you can find it when that need appears."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addResource();
          }}
          className="form-stack"
        >
          <label>
            Resource title
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Unit 2 · Place-value workshop"
            />
          </label>
          <label>
            Aligned skill
            <Pick
              label="Resource standard"
              value={standard}
              onChange={setStandard}
              options={[
                { value: "", label: "Not yet tagged" },
                ...catalog.map((s) => ({
                  value: s.code,
                  label: s.code + " · " + s.title,
                })),
              ]}
            />
          </label>
          <label>
            Page reference (optional)
            <input
              value={pages}
              onChange={(e) => setPages(e.target.value)}
              placeholder="e.g. 217–221"
            />
          </label>
          <label>
            Teaching notes
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What would you use this for?"
            />
          </label>
          <button
            type="button"
            className="curriculum-upload"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <LoaderCircle className="spin" size={20} />
            ) : (
              <Upload size={20} />
            )}
            <span>
              {upload ? upload.name : "Attach a PDF or image · Up to 8 MB"}
            </span>
          </button>
          <input
            ref={fileRef}
            aria-label="Upload curriculum file"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => uploadCurriculum(e.target.files?.[0])}
          />
          <Action type="submit" disabled={busy || uploading || !title.trim()}>
            Save resource
            <Check size={16} />
          </Action>
        </form>
      </Modal>
    </>
  );
}

export function SettingsView() {
  const { w, save, busy, aiReady, reload, go } = useTeacher();
  const [teacher, setTeacher] = useState(w.settings.teacherName),
    [school, setSchool] = useState(w.settings.school),
    [erase, setErase] = useState(false),
    [erasing, setErasing] = useState(false);
  useEffect(() => {
    setTeacher(w.settings.teacherName);
    setSchool(w.settings.school);
  }, [w.settings.teacherName, w.settings.school]);
  const theme = themeById(w.settings.theme).id;
  async function eraseData() {
    setErasing(true);
    try {
      const r = await fetch("/api/workspace", { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await reload();
      setErase(false);
      toast.success(
        "Your workspace records and uploaded documents have been deleted.",
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Deletion failed. Try again.",
      );
    } finally {
      setErasing(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="YOUR SPACE, YOUR WAY"
        title="Settings"
        description="Choose how the workspace looks and manage your account and data."
      />
      <div className="settings-layout">
        <section className="panel settings-card">
          <SectionTitle
            title="Appearance"
            description="Pick a color theme. The layout stays the same; only the palette changes."
          />
          <div className="theme-grid" role="group" aria-label="Color theme">
            {themes.map((t) => (
              <button
                type="button"
                key={t.id}
                className={"theme-swatch " + (theme === t.id ? "selected" : "")}
                style={
                  { "--th": t.hue + "deg", "--ts": String(t.saturation) } as CSSProperties
                }
                aria-pressed={theme === t.id}
                disabled={busy}
                onClick={() =>
                  save(
                    { ...w, settings: { ...w.settings, theme: t.id } },
                    t.name + " theme applied",
                  )
                }
              >
                <span className="preview" aria-hidden="true">
                  <i />
                  <span>
                    <b />
                    <b />
                  </span>
                </span>
                <strong>
                  {t.name}
                  {theme === t.id && <Check size={13} />}
                </strong>
                <small>{t.description}</small>
              </button>
            ))}
          </div>
          <div className="setting-toggle">
            <div>
              <strong>Gentler motion</strong>
              <span>
                Reduce animated entrances, chart effects, and transitions.
              </span>
            </div>
            <Switch
              aria-label="Reduce motion"
              checked={w.settings.reduceMotion}
              disabled={busy}
              onCheckedChange={(v) =>
                save({ ...w, settings: { ...w.settings, reduceMotion: v } })
              }
            />
          </div>
        </section>
        <aside>
          <section className="panel settings-card ai-settings">
            <div className="section-heading">
              <span className="soft-icon">
                <Lightbulb size={25} />
              </span>
              <Pill tone={aiReady ? "green" : "amber"}>
                {aiReady ? "Connected" : "Not connected"}
              </Pill>
            </div>
            <h2>Your instructional AI</h2>
            <p>
              {aiReady
                ? "AI reads uploaded work, retrieves state standards, and creates lesson plans for your review."
                : "Connect AI to read PDFs and photographs, retrieve state standards, analyze written work, and generate lesson plans."}
            </p>
            <div className="connection-detail">
              <span>Model</span>
              <strong>GPT-6 Astra</strong>
            </div>
            <div className="connection-detail">
              <span>Teacher review</span>
              <strong>Always required</strong>
            </div>
            {!aiReady && (
              <details className="connection-instructions">
                <summary>Connection setup</summary>
                <p>
                  The app owner can add an OpenAI API key as the hosted
                  OPENAI_API_KEY secret. The model is set to gpt-6-astra. Keep
                  the key out of student documents and client code.
                </p>
                <a
                  className="text-link"
                  href="https://developers.openai.com/api/docs/guides/latest-model"
                  target="_blank"
                  rel="noreferrer"
                >
                  Official setup guidance
                  <ArrowUpRight size={14} />
                </a>
              </details>
            )}
            <Insight>
              AI offers a suggestion. You decide what fits your students.
            </Insight>
          </section>
          <section className="panel settings-card">
            <ShieldCheck size={27} />
            <h2>Student information, thoughtfully handled</h2>
            <p>
              Use aliases where possible. Your records and documents are scoped
              to your signed-in workspace. Student identity is kept separate
              from skill evidence.
            </p>
            <p className="field-help">
              The app requests no stored AI responses. Before using real student
              work, your school should approve the AI provider and its retention
              terms.
            </p>
          </section>
        </aside>
        <section className="panel settings-card">
          <SectionTitle
            title="Your profile"
            description="The name shown in the sidebar and on printed reports."
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save(
                {
                  ...w,
                  settings: { ...w.settings, teacherName: teacher, school },
                },
                "Your profile is saved",
              );
            }}
            className="form-stack"
          >
            <div className="form-grid">
              <label>
                Your name
                <input
                  value={teacher}
                  maxLength={100}
                  onChange={(e) => setTeacher(e.target.value)}
                  placeholder="What should we call you?"
                />
              </label>
              <label>
                School or district (optional)
                <input
                  value={school}
                  maxLength={200}
                  onChange={(e) => setSchool(e.target.value)}
                />
              </label>
            </div>
            <Action
              type="submit"
              disabled={
                busy ||
                (teacher === w.settings.teacherName &&
                  school === w.settings.school)
              }
            >
              Save profile
              <Check size={16} />
            </Action>
          </form>
          <div className="settings-note">
            <Users size={17} />
            <span>
              Class names, grades, standards, and rosters live under Classes.
            </span>
            <TextLink onClick={() => go("/classes")}>Open classes</TextLink>
          </div>
        </section>
        <section className="panel settings-card data-settings">
          <SectionTitle
            title="Your data stays in your hands"
            description="Export a copy of your workspace or delete the records and documents you’ve saved."
          />
          <div className="data-actions">
            <Action
              variant="secondary"
              onClick={() =>
                downloadText(
                  "teachers-best-friend-workspace.json",
                  JSON.stringify(w, null, 2),
                  "application/json",
                )
              }
            >
              <Download size={16} />
              Export workspace
            </Action>
            <Action variant="danger" onClick={() => setErase(true)}>
              <Trash2 size={16} />
              Delete workspace data
            </Action>
          </div>
        </section>
      </div>
      <AlertDialog open={erase} onOpenChange={setErase}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete all of your workspace data?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every class’s students, assessments, evidence,
              lesson plans, custom standards, and uploaded documents from this
              app. Export a copy first if you need one. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={erasing}>
              Keep my data
            </AlertDialogCancel>
            <button
              className="action danger"
              disabled={erasing}
              onClick={eraseData}
            >
              {erasing ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Trash2 size={16} />
              )}
              Delete all data
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
