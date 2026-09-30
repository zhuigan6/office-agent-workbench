# Office window discovery and instance binding

The native bridge now integrates the read-only window scan through discovery.ps1.
Verified native panes are reacquired in the STA worker and bound to their explicit
documents. Existing application discovery covers panes unavailable to this scan;
it is labelled as fallback, not proof that every independent process was found.
Neither discovery path activates Office, changes selection, injects code or requests
elevated/debug privileges. The standalone inspection script remains read-only.

Two independent Excel processes opening the same dedicated file were verified in
.local/verification/office-instances-1790730618261/report.json. IDs remained distinct,
the ambiguous legacy ID was rejected, and closing the owned read-only test process
did not retarget the original binding. Original disk bytes remained unchanged.
Equivalent independent Word/PPT coverage remains a release gate. Partial scans and
ambiguous paths use instance identities; ambiguity stays latched for the worker
lifetime. Filename alone is never enough to choose an editing target.

## Run

From the workbench checkout, using the established Windows PowerShell 5 STA runtime:

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -STA -File scripts/Inspect-OfficeWindows.ps1
```

`-CompileOnly` checks Add-Type without enumerating windows. Compilation or policy
failure returns `ADD_TYPE_FAILED_OR_BLOCKED` on stderr and exit 1; do not change
execution policy, disable protections, elevate, or switch compilers to bypass it.
No Office installation, interop package, global setup or persistent output is needed.
Add-Type uses the existing .NET compiler and may create normal compiler temp files.

## What is discovered

EnumWindows supplies existing top-level windows on the calling desktop;
EnumChildWindows includes descendants. GetWindowThreadProcessId ties each pane
to its process. The probe reads process image, session, creation time, token user
SID and elevation using query-only access. Native access occurs only for verified
same-user, same-session WINWORD.EXE, EXCEL.EXE or POWERPNT.EXE processes. Elevated
processes are deliberately skipped, even if the caller could access them.

| Native pane class | Returned native object | Concrete document getter |
| --- | --- | --- |
| `_WwG` | Word Window | `Window.Document` |
| `EXCEL7` | Excel Window | `Window.Parent` |
| `paneClassDC` | PowerPoint DocumentWindow | `DocumentWindow.Presentation` |

AccessibleObjectFromWindow uses OBJID_NATIVEOM and IID_IDispatch. The probe reads
`Application` directly from that native window, independently of document lookup.
`applicationAccessible` reports whether this getter succeeded; no application
collection, ActiveWindow or ActiveDocument is consulted. Concrete document metadata
is limited to Name, FullName and Path. An unsaved document may have an empty Path;
these values are labels, not binding IDs. Getters use explicit LCID 1033, not a
system-locale change. No arbitrary property or method is accepted as input.

**JSON contains metadata, not transferable COM objects.** The native objects are
available inside the STA scan only. `native-window-accessible` means native access
succeeded but does not imply document metadata succeeded. `document-accessible`
means the explicit document getter and all three metadata getters succeeded.
Application access is a separate boolean. These are not editability guarantees.

## Identity and bounds

Native COM IUnknown identities are retained until the scan finishes. Repeated panes
for the same native window merge into one row with multiple Win32 evidence entries;
documents and applications have separate identity maps. Every scan has a fresh
worker GUID. Window/document/application IDs are scoped to it and cannot be used as
persistent binding tickets. PID plus process creation time identifies a process,
not a guarantee of one Office application or one document per process.

PowerPoint DocumentWindow has no HWND property. `topLevelHwnd` and `paneHwnd` are
**Win32 enumeration evidence**, never fabricated COM HWNDs. They may be recycled;
no binding should rely on them alone. The probe rechecks PID, process liveness and
pane class before native access and after metadata, but a snapshot is not atomic.

Defaults: 64 native candidates, 2048 top-level windows, 8192 total child windows,
1024 children per root, 256 diagnostics, 32768 characters per metadata field,
and a 10-second soft deadline. Parameters have hard upper limits. Exhaustion sets
`truncated`; partial scans must not be interpreted as absence. Counts bound work,
**not a blocked COM call's duration**. There is no safe in-process cancellation of
AccessibleObjectFromWindow/property getters. Tests impose a 25-second external
timeout on this disposable probe process only, never on Office or a service.

## Diagnostics and coverage limits

- `instances` summarizes verified current-user Office processes with existing
  windows, including those with no usable native pane. It is not all processes.
- `NO_SUPPORTED_NATIVE_PANE` means no documented class was seen for that process
  in this snapshot. New Office layouts, backstage/start screens, protected views
  and slideshow-only windows may not expose a supported native object.
- `NATIVEOM_UNAVAILABLE` includes the API HRESULT; native or metadata exceptions
  use `NATIVEOM_OR_METADATA_FAILED`. Application getter failures have their own
  `APPLICATION_UNAVAILABLE` diagnostic. There is no activation/retry fallback.
- `ELEVATED_SKIPPED`, `PROCESS_UNVERIFIED`, `HUNG_WINDOW_SKIPPED` and `WINDOW_CHANGED`
  are explicit refusal/race diagnostics. Unknown ownership fails closed; process
  access failures may prevent even identifying a window as Office.
- Other-user/session processes are excluded, with only an aggregate skip count
  when identity can be verified. Their document names/paths are never queried.
  Other desktops, remote sessions and windowless Office instances are not covered.
- Hidden/minimized windows are not filtered; their flags are reported with each
  pane. Offscreen position and virtual-desktop membership are not assessed. An
  offscreen/hidden app without an exposed native pane remains undiscoverable here.
- Multi-instance, multiple windows per document, same-name documents, elevated,
  other-user, offscreen, window-close races and protected-view scenarios require
  separate controlled acceptance. One observed process per host proves none of them.

## Initial read-only evidence (2026-09-30)

Windows PowerShell 5 STA compiled the C# source without policy changes. A complete
scan observed one current-user process each for Word, Excel and PowerPoint.
Word and Excel exposed native windows whose Application and concrete document
metadata getters succeeded. A second Word pane returned `0x80004005`.
PowerPoint exposed no `paneClassDC` candidate and is explicitly unsupported in that
snapshot. This does not contradict the main bridge's independent PPT acceptance:
the probe intentionally does not borrow its active-object path or bindings.

Initial Excel metadata using invariant culture failed with `0x80028018`; the
explicit LCID 1033 getter resolved that failure. No locale or Office state changed.
No all-instance coverage is claimed. Raw document names and paths are deliberately
omitted from this evidence note; JSON output itself should be treated as sensitive.

```powershell
node --import tsx --test tests/office-windows.test.ts
npm run check
```

Tests cover fixed APIs/read-only constraints, identity retention, compiled class
mapping and invalid bounds, a live read-only snapshot, and a forced partial scan.
Static checks are regression guards, not a proof of runtime isolation.

## Official references

- [AccessibleObjectFromWindow and Office class mappings](https://learn.microsoft.com/en-us/windows/win32/api/oleacc/nf-oleacc-accessibleobjectfromwindow)
- [EnumWindows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumwindows)
- [EnumChildWindows](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumchildwindows)
- [GetWindowThreadProcessId](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowthreadprocessid)
- [OpenProcessToken](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocesstoken)
- [GetTokenInformation](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)
- [Word Window.Document](https://learn.microsoft.com/en-us/office/vba/api/word.window.document)
- [Excel Window.Parent](https://learn.microsoft.com/en-us/office/vba/api/excel.window.parent)
- [PowerPoint DocumentWindow.Presentation](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.documentwindow.presentation)
- [Excel COM globalization and LCID 1033](https://learn.microsoft.com/en-us/visualstudio/vsto/globalization-and-localization-of-excel-solutions?view=visualstudio)
