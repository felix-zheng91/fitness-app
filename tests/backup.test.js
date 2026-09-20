const test = require("node:test");
const assert = require("node:assert/strict");
const { createAppHarness } = require("./app-harness");

test("export envelope identifies the format and summarizes the real payload", () => {
  const app = createAppHarness();
  const actual = app.run(`(() => {
    if (typeof createBackupEnvelope !== "function") return null;
    const backup = createBackupEnvelope(ROOT, new Date("2026-09-20T03:04:05.000Z"));
    return {
      format: backup.format,
      formatVersion: backup.formatVersion,
      exportedAt: backup.exportedAt,
      summary: backup.summary,
      usesCurrentData: backup.data === ROOT
    };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    format: "fitlog-backup",
    formatVersion: 1,
    exportedAt: "2026-09-20T03:04:05.000Z",
    summary: {
      profiles: 1,
      weights: 0,
      trainings: 0,
      dietDays: 0,
      photos: 0,
      customActions: 0
    },
    usesCurrentData: true
  });
});

test("new-format import reads the payload and recomputes its summary", () => {
  const app = createAppHarness();
  const actual = app.run(`(() => {
    if (typeof parseBackupText !== "function") return null;
    ROOT.profiles.p1.data.weights.push({date:"2026-09-20",weight:58.4});
    const envelope = createBackupEnvelope(ROOT, new Date("2026-09-20T03:04:05.000Z"));
    envelope.summary.weights = 999;
    const parsed = parseBackupText(JSON.stringify(envelope));
    return {
      active: parsed.root.active,
      legacy: parsed.legacy,
      exportedAt: parsed.exportedAt,
      summary: parsed.summary
    };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    active: "p1",
    legacy: false,
    exportedAt: "2026-09-20T03:04:05.000Z",
    summary: {
      profiles: 1,
      weights: 1,
      trainings: 0,
      dietDays: 0,
      photos: 0,
      customActions: 0
    }
  });
});

test("legacy root-only JSON remains importable", () => {
  const app = createAppHarness();
  const actual = app.run(`(() => {
    if (typeof parseBackupText !== "function") return null;
    const parsed = parseBackupText(JSON.stringify(ROOT));
    return {
      active: parsed.root.active,
      legacy: parsed.legacy,
      exportedAt: parsed.exportedAt,
      profiles: parsed.summary.profiles
    };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    active: "p1",
    legacy: true,
    exportedAt: null,
    profiles: 1
  });
});

test("an unknown tagged format is not mistaken for a legacy backup", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.format = "some-other-app";
    try { parseBackupText(JSON.stringify(candidate)); return "accepted"; }
    catch (error) { return error.message; }
  })()`);

  assert.equal(message, "无法识别的备份格式");
});

test("an inherited object key cannot become the active profile", () => {
  const app = createAppHarness();
  const active = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.active = "toString";
    return parseBackupText(JSON.stringify(candidate)).root.active;
  })()`);

  assert.equal(active, "p1");
});

test("import rejects profile identifiers that can escape inline handlers", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    const profile = candidate.profiles.p1;
    delete candidate.profiles.p1;
    candidate.profiles["p1');alert(1)//"] = profile;
    candidate.active = "p1');alert(1)//";
    try { parseBackupText(JSON.stringify(candidate)); return "accepted"; }
    catch (error) { return error.message; }
  })()`);

  assert.equal(message, "档案标识格式错误");
});

test("import rejects prototype-pollution keys before normalization", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    Object.defineProperty(candidate.profiles.p1.data, "__proto__", {
      value: {polluted:true}, enumerable:true
    });
    try {
      parseBackupText(JSON.stringify(candidate));
      return "accepted";
    } catch (error) {
      return error.message;
    }
  })()`);

  assert.equal(message, "备份包含不安全字段：__proto__");
});

test("import rejects a backup without any recoverable profiles", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    try {
      parseBackupText(JSON.stringify({active:"p1",profiles:{}}));
      return "accepted";
    } catch (error) {
      return error.message;
    }
  })()`);

  assert.equal(message, "备份中没有可恢复的档案");
});

test("legacy profiles with missing optional collections are normalized", () => {
  const app = createAppHarness();
  const actual = app.run(`(() => {
    const parsed = parseBackupText(JSON.stringify({
      active:"legacy",
      profiles:{legacy:{id:"legacy",name:"旧档案",data:{}}}
    }));
    const data = parsed.root.profiles.legacy.data;
    return {
      active:parsed.root.active,
      arrays:[data.weights,data.trainings,data.photos,data.customActions,data.trash].map(Array.isArray),
      dietDays:Object.keys(data.diets).length,
      summary:parsed.summary
    };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    active:"legacy",
    arrays:[true,true,true,true,true],
    dietDays:0,
    summary:{profiles:1,weights:0,trainings:0,dietDays:0,photos:0,customActions:0}
  });
});

test("legacy partial profile and target objects are backfilled", () => {
  const app = createAppHarness();
  const actual = app.run(`(() => {
    const parsed = parseBackupText(JSON.stringify({
      active:"legacy",
      profiles:{legacy:{id:"legacy",name:"旧档案",data:{
        profile:{gender:"男"},targets:{calories:1800}
      }}}
    }));
    const data = parsed.root.profiles.legacy.data;
    return {profile:data.profile,targets:data.targets};
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    profile:{gender:"男",age:30,height:165,weightStart:60,weightGoal:55},
    targets:{calories:1800,protein:100,fat:50,carbs:150}
  });
});

test("import rejects a collection with the wrong type", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.weights = {date:"2026-09-20",weight:58.4};
    try {
      parseBackupText(JSON.stringify(candidate));
      return "accepted";
    } catch (error) {
      return error.message;
    }
  })()`);

  assert.equal(message, "档案 p1 的 weights 格式错误");
});

test("import rejects map-shaped data stored as an array", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.diets = [];
    try {
      parseBackupText(JSON.stringify(candidate));
      return "accepted";
    } catch (error) {
      return error.message;
    }
  })()`);

  assert.equal(message, "档案 p1 的 diets 格式错误");
});

test("import rejects photo URLs that can execute active content", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.photos.push({
      date:"2026-09-20",
      data:"data:text/html,<script>alert(1)<\\/script>",
      note:""
    });
    try {
      parseBackupText(JSON.stringify(candidate));
      return "accepted";
    } catch (error) {
      return error.message;
    }
  })()`);

  assert.equal(message, "档案 p1 包含不安全的照片数据");
});

test("import also validates deleted photos before they can be restored", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.trash.push({
      uid:"safe_deleted_photo_1",
      type:"photo",
      deletedAt:"2026-09-20",
      data:{date:"2026-09-20",data:"javascript:alert(1)",note:""}
    });
    try {
      parseBackupText(JSON.stringify(candidate));
      return "accepted";
    } catch (error) {
      return error.message;
    }
  })()`);

  assert.equal(message, "档案 p1 包含不安全的照片数据");
});

test("import rejects recycle-bin identifiers that can escape inline handlers", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.trash.push({
      uid:"x');alert(1)//",type:"weight",deletedAt:"2026-09-20",
      data:{date:"2026-09-01",weight:60}
    });
    try { parseBackupText(JSON.stringify(candidate)); return "accepted"; }
    catch (error) { return error.message; }
  })()`);

  assert.equal(message, "档案 p1 包含无效的回收站标识");
});

test("import rejects record dates that can escape inline handlers", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.weights.push({date:"x');alert(1)//",weight:60});
    try { parseBackupText(JSON.stringify(candidate)); return "accepted"; }
    catch (error) { return error.message; }
  })()`);

  assert.equal(message, "档案 p1 包含无效的记录日期");
});

test("import rejects impossible calendar dates", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.weights.push({date:"2026-02-31",weight:60});
    try { parseBackupText(JSON.stringify(candidate)); return "accepted"; }
    catch (error) { return error.message; }
  })()`);

  assert.equal(message, "档案 p1 包含无效的记录日期");
});

test("imported display text cannot create new HTML attributes", () => {
  const app = createAppHarness();
  const html = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.name = '\" onmouseover=\"alert(1)';
    commitImportedRoot(parseBackupText(JSON.stringify(candidate)).root);
    renderAvatars();
    return $("pf_avatars").innerHTML;
  })()`);

  assert.match(html, /title="&quot; onmouseover=&quot;alert\(1\)"/);
  assert.doesNotMatch(html, /title="" onmouseover="alert\(1\)"/);
});

test("import rejects custom-action identifiers that can create attributes", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.customActions.push({
      id:'bad" onfocus="alert(1)',name:"恶意动作",how:"",phase:"all"
    });
    try { parseBackupText(JSON.stringify(candidate)); return "accepted"; }
    catch (error) { return error.message; }
  })()`);

  assert.equal(message, "档案 p1 包含无效的动作标识");
});

test("imported profile fields are escaped in the rendered summary", () => {
  const app = createAppHarness();
  const html = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.profile.gender = '<img src=x onerror="alert(1)">';
    commitImportedRoot(parseBackupText(JSON.stringify(candidate)).root);
    renderData();
    renderPfList();
    return {summary:$("d_profile").innerHTML,list:$("pf_list").innerHTML};
  })()`);

  assert.match(html.summary, /性别 &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html.list, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html.summary + html.list, /<img src=x/);
});

test("imported training loads are escaped in the last-session hint", () => {
  const app = createAppHarness();
  const html = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.trainings.push({
      date:"2026-09-20",template:"基础激活日",rpe:"",note:"",
      items:[{actionId:"pf",name:"盆底肌收缩",done:true,sets:'<img src=x onerror="alert(1)">',reps:"10",weight:""}]
    });
    commitImportedRoot(parseBackupText(JSON.stringify(candidate)).root);
    $("tpl_sel").value="基础激活日";
    loadTemplate();
    return $("tpl_items").innerHTML;
  })()`);

  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;×10/);
  assert.doesNotMatch(html, /<img src=x/);
});

test("corrupt domain records are rejected before they reach renderers", () => {
  const app = createAppHarness();
  const messages = app.run(`(() => {
    const check = mutate => {
      const candidate = JSON.parse(JSON.stringify(ROOT));
      mutate(candidate.profiles.p1.data);
      try { parseBackupText(JSON.stringify(candidate)); return "accepted"; }
      catch (error) { return error.message; }
    };
    return [
      check(data => data.weights.push({date:"2026-09-20",weight:"<img>"})),
      check(data => data.trainings.push({date:"2026-09-20",template:"测试",items:null})),
      check(data => { data.diets["2026-09-20"]={meals:"bad"}; }),
      check(data => { data.activity="<img>"; }),
      check(data => { data.templates["基础激活日"]={not:"an array"}; })
    ];
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    "档案 p1 的体重记录格式错误",
    "档案 p1 的训练记录格式错误",
    "档案 p1 的饮食记录格式错误",
    "档案 p1 的活动系数格式错误",
    "档案 p1 的训练模板格式错误"
  ]);
});

test("corrupt recycle-bin payloads are rejected before renderTrash", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.trash.push({
      uid:"safe_train_1",type:"train",deletedAt:"2026-09-20",
      data:{date:"2026-09-19",template:"测试",items:null}
    });
    try { parseBackupText(JSON.stringify(candidate)); return "accepted"; }
    catch (error) { return error.message; }
  })()`);

  assert.equal(message, "档案 p1 的回收站记录格式错误");
});

test("failed persistence leaves both memory and local storage untouched", () => {
  const app = createAppHarness();
  const before = app.values.fitlog_v1;
  app.failStorageWrites();
  const actual = app.run(`(() => {
    if (typeof commitImportedRoot !== "function") return null;
    const candidate = JSON.parse(localStorage.getItem(DB_KEY));
    candidate.profiles.p1.name = "导入后的名字";
    let message = "accepted";
    try { commitImportedRoot(candidate); } catch (error) { message = error.message; }
    return {
      message,
      memoryName:ROOT.profiles.p1.name,
      stored:localStorage.getItem(DB_KEY)
    };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    message:"无法保存导入数据，本机存储空间可能不足",
    memoryName:"我的档案",
    stored:before
  });
});

test("a successful import can be undone once during the current session", () => {
  const app = createAppHarness();
  const actual = app.run(`(() => {
    if (typeof undoImport !== "function") return null;
    const candidate = JSON.parse(localStorage.getItem(DB_KEY));
    candidate.profiles.p1.name = "导入后的名字";
    commitImportedRoot(candidate);
    const importedName = ROOT.profiles.p1.name;
    const firstUndo = undoImport();
    const restoredName = ROOT.profiles.p1.name;
    const storedName = JSON.parse(localStorage.getItem(DB_KEY)).profiles.p1.name;
    const secondUndo = undoImport();
    return {importedName,firstUndo,restoredName,storedName,secondUndo};
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    importedName:"导入后的名字",
    firstUndo:true,
    restoredName:"我的档案",
    storedName:"我的档案",
    secondUndo:false
  });
});

test("undo restores the live pre-import state even when local storage was stale", () => {
  const app = createAppHarness();
  app.failStorageWrites();
  app.run(`ROOT.profiles.p1.name="尚未落盘的名字";save();`);
  app.allowStorageWrites();
  const actual = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.name = "导入后的名字";
    commitImportedRoot(candidate);
    undoImport();
    return {
      memoryName:ROOT.profiles.p1.name,
      storedName:JSON.parse(localStorage.getItem(DB_KEY)).profiles.p1.name
    };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    memoryName:"尚未落盘的名字",
    storedName:"尚未落盘的名字"
  });
});

test("backup filename includes a local timestamp down to seconds", () => {
  const app = createAppHarness();
  const filename = app.run(`typeof backupFilename === "function"
    ? backupFilename(new Date(2026,8,20,3,4,5))
    : null`);

  assert.equal(filename, "fitlog_backup_20260920_030405.json");
});

test("oversized backup files are rejected before FileReader loads them", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    if (typeof assertBackupFileSize !== "function") return "missing";
    try {
      assertBackupFileSize(20*1024*1024+1);
      return "accepted";
    } catch (error) {
      return error.message;
    }
  })()`);

  assert.equal(message, "备份文件过大（上限 20 MB）");
});

test("pathological record counts are rejected before persistence", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.data.weights = Array.from({length:10001},()=>({date:"2026-09-20",weight:60}));
    try { parseBackupText(JSON.stringify(candidate)); return "accepted"; }
    catch (error) { return error.message; }
  })()`);

  assert.equal(message, "档案 p1 的体重记录超过 10000 条上限");
});

test("nested training and template action arrays have independent caps", () => {
  const app = createAppHarness();
  const messages = app.run(`(() => {
    const check = mutate => {
      const candidate = JSON.parse(JSON.stringify(ROOT));
      mutate(candidate.profiles.p1.data);
      try { parseBackupText(JSON.stringify(candidate)); return "accepted"; }
      catch (error) { return error.message; }
    };
    const row={actionId:"pf",name:"核心收紧",done:false,sets:"",reps:"",weight:""};
    return [
      check(data => { data.templates["基础激活日"]=Array(201).fill("pf"); }),
      check(data => { data.trainings.push({date:"2026-09-20",template:"基础激活日",rpe:"",note:"",items:Array.from({length:201},()=>({...row}))}); }),
      check(data => {
        data.templates={};
        for(let i=0;i<201;i++)data.templates["模板"+i]=["pf"];
      })
    ];
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    "档案 p1 的单个训练模板动作超过 200 个上限",
    "档案 p1 的单次训练动作超过 200 个上限",
    "档案 p1 的训练模板超过 200 个上限"
  ]);
});

test("exportData downloads a versioned backup and releases its Blob URL", () => {
  const app = createAppHarness();
  app.run(`ROOT.profiles.p1.data.weights.push({date:"2026-09-20",weight:58.4});exportData();`);

  const anchor = app.createdNodes.find(node => node.tagName === "A");
  const downloaded = JSON.parse(app.blobs[0].parts.join(""));
  assert.equal(anchor.clicked, true);
  assert.match(anchor.download, /^fitlog_backup_\d{8}_\d{6}\.json$/);
  assert.equal(downloaded.format, "fitlog-backup");
  assert.equal(downloaded.formatVersion, 1);
  assert.equal(downloaded.summary.weights, 1);
  assert.deepEqual(app.objectUrls.revoked, [app.objectUrls.created[0].url]);
});

test("exportData refuses to create a backup that this app cannot restore", () => {
  const app = createAppHarness();
  app.run(`(() => {
    for(let i=2;i<=51;i++){
      const id="p"+i;
      ROOT.profiles[id]={id,name:"档案"+i,createdAt:"2026-09-20",data:freshData()};
    }
    exportData();
  })()`);

  assert.equal(app.blobs.length, 0);
  assert.equal(app.createdNodes.filter(node => node.tagName === "A").length, 0);
  assert.equal(app.alerts.at(-1), "无法导出备份：备份中的档案数量超过 50 个上限");
});

test("interactive mutation paths enforce restorable profile, action, and meal caps", () => {
  const app = createAppHarness();
  const actual = app.run(`(() => {
    for(let i=2;i<=50;i++){
      const id="p"+i;
      ROOT.profiles[id]={id,name:"档案"+i,createdAt:"2026-09-20",data:freshData()};
    }
    $("np_name").value="第 51 个档案";
    newProfile();

    DB.customActions=Array.from({length:1000},(_,i)=>({id:"c"+i,name:"动作"+i,how:"",phase:"custom"}));
    editingIds=[];
    $("ca_name").value="第 1001 个动作";
    $("ca_how").value="";
    addCustomAction();

    const date=todayStr();
    DB.diets[date]={meals:Array.from({length:500},()=>({type:"M",name:"餐",kcal:1,p:1,f:1,c:1}))};
    $("m_name").value="第 501 餐";
    manualMeal();
    return {
      profiles:Object.keys(ROOT.profiles).length,
      actions:DB.customActions.length,
      meals:DB.diets[date].meals.length
    };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {profiles:50,actions:1000,meals:500});
  assert.deepEqual(app.alerts.slice(-3), [
    "档案数量已达 50 个上限",
    "自定义动作已达 1000 个上限",
    "当天饮食记录已达 500 条上限"
  ]);
});

test("importData previews real counts before atomically replacing local data", () => {
  const app = createAppHarness();
  const actual = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.name = "云端档案";
    candidate.profiles.p1.data.weights.push({date:"2026-09-20",weight:58.4});
    const content = JSON.stringify(createBackupEnvelope(candidate,new Date("2026-09-20T03:04:05.000Z")));
    const input = $("imp");
    input.files = [{name:"fitlog_backup.json",size:content.length,content}];
    input.value = "selected";
    importData(input);
    return {
      memoryName:ROOT.profiles.p1.name,
      storedName:JSON.parse(localStorage.getItem(DB_KEY)).profiles.p1.name,
      inputValue:input.value,
      message:$("d_msg").textContent,
      undoDisplay:$("undo_import").style.display
    };
  })()`);

  assert.match(app.confirms[0], /fitlog_backup\.json/);
  assert.match(app.confirms[0], /档案 1 个/);
  assert.match(app.confirms[0], /体重 1 条/);
  assert.match(app.confirms[0], /训练 0 次/);
  assert.match(app.confirms[0], /照片 0 张/);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    memoryName:"云端档案",
    storedName:"云端档案",
    inputValue:"",
    message:"导入成功：1 个档案、1 条体重、0 次训练、0 张照片。",
    undoDisplay:"inline-flex"
  });
});

test("importData rolls back persistence when the first render fails", () => {
  const app = createAppHarness();
  const actual = app.run(`(() => {
    const candidate = JSON.parse(JSON.stringify(ROOT));
    candidate.profiles.p1.name = "不能显示的导入";
    const content = JSON.stringify(createBackupEnvelope(candidate,new Date("2026-09-20T03:04:05.000Z")));
    const originalRenderAll = renderAll;
    let renderCalls = 0;
    renderAll = function(){ renderCalls++; if(renderCalls===1)throw new Error("render boom"); return originalRenderAll(); };
    const input = $("imp");
    input.files = [{name:"render-failure.json",size:content.length,content}];
    input.value = "selected";
    importData(input);
    return {
      memoryName:ROOT.profiles.p1.name,
      storedName:JSON.parse(localStorage.getItem(DB_KEY)).profiles.p1.name,
      undoDisplay:$("undo_import").style.display,
      renderCalls
    };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    memoryName:"我的档案",
    storedName:"我的档案",
    undoDisplay:"none",
    renderCalls:2
  });
  assert.equal(app.alerts.at(-1), "无法导入：备份数据无法完整显示，已恢复原数据");
});

test("malformed JSON reports a stable user-facing error", () => {
  const app = createAppHarness();
  const message = app.run(`(() => {
    try { parseBackupText("{"); return "accepted"; }
    catch (error) { return error.message; }
  })()`);

  assert.equal(message, "备份文件不是有效的 JSON");
});

test("undoImport refreshes the UI and removes the one-time undo action", () => {
  const app = createAppHarness();
  const actual = app.run(`(() => {
    const candidate = JSON.parse(localStorage.getItem(DB_KEY));
    candidate.profiles.p1.name = "导入后的名字";
    commitImportedRoot(candidate);
    $("undo_import").style.display = "inline-flex";
    const result = undoImport();
    return {
      result,
      name:ROOT.profiles.p1.name,
      message:$("d_msg").textContent,
      undoDisplay:$("undo_import").style.display
    };
  })()`);

  assert.deepEqual(JSON.parse(JSON.stringify(actual)), {
    result:true,
    name:"我的档案",
    message:"已恢复导入前的数据。",
    undoDisplay:"none"
  });
});
