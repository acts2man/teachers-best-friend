import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
function bundle(path){const result=buildSync({entryPoints:[path],bundle:true,platform:"node",format:"cjs",write:false});const module={exports:{}};new Function("module","exports",result.outputFiles[0].text)(module,module.exports);return module.exports}
const {matchRosterStudent,resolveScannedGroups,applyScannedGroups}=bundle("lib/teacher-class-scan.ts");

function assessment(){
  return {
    id:"a1",classId:"c1",title:"Quiz",subject:"Math",grade:4,framework:"Common Core",createdAt:"",status:"Ready",
    questions:[{id:"q1",number:1,text:"1+1",passage:"",answer:"2",standard:"4.OA.1",secondary:"",skill:"",dok:1,alignment:100,confidence:100,level:"On grade",reasoning:"",verified:true,excluded:false}],
    responses:[],uploadIds:[],source:"manual",targetStandards:["4.OA.1"],studentUploadIds:{},
  };
}
function student(id,name,classId="c1"){return {id,classId,name,color:"#000",evidence:[],notes:""}}

test("exact roster name matches regardless of case and spacing",()=>{
  const students=[student("s1"," Maria  Gonzalez ")];
  assert.equal(matchRosterStudent("maria gonzalez",students).id,"s1");
});
test("first-name + last-initial matches a shortened name",()=>{
  const students=[student("s1","Maria Gonzalez"),student("s2","Jamal Thompson")];
  assert.equal(matchRosterStudent("Maria G.",students)?.id,"s1");
  assert.equal(matchRosterStudent("Maria Gonzalez",students).id,"s1");
});
test("an ambiguous shortened name resolves to the first roster match, in roster order — the teacher still confirms it before saving",()=>{
  const students=[student("s1","Maria Gonzalez"),student("s2","Maria Garcia")];
  assert.equal(matchRosterStudent("Maria G.",students)?.id,"s1");
});
test("a single-token name never matches (too ambiguous to guess)",()=>{
  const students=[student("s1","Maria Gonzalez")];
  assert.equal(matchRosterStudent("Maria",students),undefined);
});
test("no match returns undefined rather than guessing",()=>{
  const students=[student("s1","Maria Gonzalez")];
  assert.equal(matchRosterStudent("Jamal Thompson",students),undefined);
});

test("resolveScannedGroups clamps page indexes to the real upload list and dedupes",()=>{
  const groups=[{pageIndexes:[0,0,5,-1],detectedName:"Jamal T",matchedRosterName:"",confidence:80,responses:[]}];
  const resolved=resolveScannedGroups(groups,["u1","u2"],[]);
  assert.deepEqual(resolved[0].pageIndexes,[0]);
  assert.deepEqual(resolved[0].pageUploadIds,["u1"]);
});
test("resolveScannedGroups prefers the model's roster match, then falls back to loose matching, then a placeholder name",()=>{
  const students=[student("s1","Maria Gonzalez"),student("s2","Jamal Thompson")];
  const groups=[
    {pageIndexes:[0],detectedName:"illegible",matchedRosterName:"Maria Gonzalez",confidence:90,responses:[]},
    {pageIndexes:[1],detectedName:"Jamal T.",matchedRosterName:"",confidence:70,responses:[]},
    {pageIndexes:[2],detectedName:"",matchedRosterName:"",confidence:0,responses:[]},
  ];
  const resolved=resolveScannedGroups(groups,["u1","u2","u3"],students);
  assert.equal(resolved[0].studentId,"s1");
  assert.equal(resolved[1].studentId,"s2");
  assert.equal(resolved[2].studentId,null);
  assert.equal(resolved[2].name,"Student 3");
});

test("applyScannedGroups grades a matched student and creates a record for an unmatched one",()=>{
  const a=assessment();
  const students=[student("s1","Maria Gonzalez")];
  const result=applyScannedGroups(a,students,"c1",[
    {studentId:"s1",name:"Maria Gonzalez",pageUploadIds:["u1"],responses:[{questionId:"q1",answer:"2",correct:true,match:100,misconception:"",confidence:95}]},
    {studentId:null,name:"New Kid",pageUploadIds:["u2"],responses:[{questionId:"q1",answer:"3",correct:false,match:0,misconception:"Miscounted",confidence:90}]},
  ]);
  assert.equal(result.newStudents.length,1);
  assert.equal(result.newStudents[0].name,"New Kid");
  assert.equal(result.students.length,2);
  assert.equal(result.assessment.responses.length,2);
  assert.ok(result.assessment.responses.some(r=>r.studentId==="s1"&&r.correct===true));
  assert.ok(result.assessment.responses.some(r=>r.studentId===result.newStudents[0].id&&r.correct===false));
  assert.deepEqual(result.assessment.studentUploadIds.s1,["u1"]);
  assert.deepEqual(result.assessment.studentUploadIds[result.newStudents[0].id],["u2"]);
  assert.deepEqual(result.assessment.uploadIds.slice().sort(),["u1","u2"]);
  assert.equal(result.studentCount,2);
});

test("applyScannedGroups replaces a student's prior responses for this assessment rather than duplicating them",()=>{
  const a=assessment();
  a.responses=[{id:"old",studentId:"s1",questionId:"q1",answer:"1",correct:false,match:0,misconception:"",confidence:80,verified:true}];
  const students=[student("s1","Maria Gonzalez")];
  const result=applyScannedGroups(a,students,"c1",[
    {studentId:"s1",name:"Maria Gonzalez",pageUploadIds:["u1"],responses:[{questionId:"q1",answer:"2",correct:true,match:100,misconception:"",confidence:95}]},
  ]);
  assert.equal(result.assessment.responses.length,1);
  assert.equal(result.assessment.responses[0].correct,true);
});

test("a group with no pages or no responses is skipped entirely",()=>{
  const a=assessment();
  const result=applyScannedGroups(a,[],"c1",[
    {studentId:null,name:"Empty",pageUploadIds:[],responses:[{questionId:"q1",answer:"2",correct:true,match:100,misconception:"",confidence:95}]},
    {studentId:null,name:"No answers",pageUploadIds:["u1"],responses:[]},
  ]);
  assert.equal(result.newStudents.length,0);
  assert.equal(result.assessment.responses.length,0);
});
