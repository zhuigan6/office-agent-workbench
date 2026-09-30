using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace Workbench.OfficeWindows
{
    public sealed class Evidence
    {
        public string topLevelHwnd;
        public string paneHwnd;
        public string paneClass;
        public uint threadId;
        public bool topLevelVisible;
        public bool topLevelMinimized;
    }

    public sealed class DocumentWindow
    {
        public string windowId;
        public string documentId;
        public string instanceId;
        public bool applicationAccessible;
        public string applicationId;
        public uint processId;
        public string kind;
        public string status;
        public string name;
        public string fullName;
        public string path;
        public List<Evidence> evidence = new List<Evidence>();
    }

    public sealed class Diagnostic
    {
        public string code;
        public uint processId;
        public string hwnd;
        public string hresult;
    }

    public sealed class Instance
    {
        public uint processId;
        public string executable;
        public string instanceId;
        public string status;
        public int topLevelWindows;
        public int nativePaneCandidates;
    }

    public sealed class Report
    {
        public string workerId = Guid.NewGuid().ToString();
        public string scope = "current-user-current-session-current-desktop";
        public bool readOnly = true;
        public string offscreenAssessment = "not-assessed; hidden/minimized windows are not filtered";
        public bool truncated;
        public int topLevelsVisited;
        public int childrenVisited;
        public int candidatesVisited;
        public int foreignProcessesSkipped;
        public long elapsedMs;
        public List<DocumentWindow> windows = new List<DocumentWindow>();
        public List<Instance> instances = new List<Instance>();
        public List<Diagnostic> diagnostics = new List<Diagnostic>();
    }

    // Standalone snapshot only. No ROT fallback, Office activation, or binding changes.
    public sealed class Probe
    {
        private delegate bool EnumProc(IntPtr hwnd, IntPtr parameter);
        [DllImport("user32.dll", SetLastError = true)] private static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
        [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr parameter);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
        [DllImport("user32.dll")] private static extern bool IsHungAppWindow(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref int size);
        [DllImport("kernel32.dll")] private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);
        [DllImport("kernel32.dll")] private static extern uint GetCurrentProcessId();
        [DllImport("kernel32.dll")] private static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
        [DllImport("kernel32.dll")] private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int size, out int needed);
        [DllImport("oleacc.dll", PreserveSig = true)] private static extern int AccessibleObjectFromWindow(
            IntPtr hwnd, uint objectId, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object result);

        private sealed class Owner
        {
            internal IntPtr handle;
            internal string executable;
            internal string instanceId;
            internal string status;
            internal bool sameUser;
            internal int roots;
            internal int candidates;
            internal bool diagnosed;
        }

        private readonly Report report = new Report();
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly Dictionary<uint, Owner> owners = new Dictionary<uint, Owner>();
        private readonly Dictionary<string, DocumentWindow> windows = new Dictionary<string, DocumentWindow>();
        private readonly Dictionary<string, string> documents = new Dictionary<string, string>();
        private readonly Dictionary<string, string> applications = new Dictionary<string, string>();
        private readonly List<IntPtr> retainedIdentities = new List<IntPtr>();
        private readonly List<object> acquiredObjects = new List<object>();
        private readonly HashSet<IntPtr> panes = new HashSet<IntPtr>();
        private int maxCandidates;
        private int maxTopLevels;
        private int maxChildren;
        private int softDeadlineMs;
        private string userSid;
        private uint sessionId;

        public static string KindFor(string executable, string paneClass)
        {
            if (String.Equals(executable, "WINWORD.EXE", StringComparison.OrdinalIgnoreCase) && paneClass == "_WwG") return "word";
            if (String.Equals(executable, "EXCEL.EXE", StringComparison.OrdinalIgnoreCase) && paneClass == "EXCEL7") return "excel";
            if (String.Equals(executable, "POWERPNT.EXE", StringComparison.OrdinalIgnoreCase) && paneClass == "paneClassDC") return "powerpoint";
            return null;
        }

        public static void ValidateLimits(int candidates, int topLevels, int children, int deadlineMs)
        {
            if (candidates < 1 || candidates > 128 || topLevels < 1 || topLevels > 4096 ||
                children < 1 || children > 16384 || deadlineMs < 100 || deadlineMs > 30000)
                throw new ArgumentOutOfRangeException("limits");
        }

        private static string HandleText(IntPtr value) { return "0x" + value.ToInt64().ToString("X", CultureInfo.InvariantCulture); }
        private static string ClassOf(IntPtr hwnd)
        {
            StringBuilder text = new StringBuilder(256);
            return GetClassName(hwnd, text, text.Capacity) == 0 ? "" : text.ToString();
        }
        private void Note(string code, uint pid, IntPtr hwnd, int hr)
        {
            if (report.diagnostics.Count >= 256) { report.truncated = true; return; }
            report.diagnostics.Add(new Diagnostic { code = code, processId = pid, hwnd = HandleText(hwnd),
                hresult = hr == 0 ? null : "0x" + unchecked((uint)hr).ToString("X8", CultureInfo.InvariantCulture) });
        }
        private bool Budget()
        {
            if (clock.ElapsedMilliseconds < softDeadlineMs) return true;
            if (!report.truncated) Note("SOFT_DEADLINE", 0, IntPtr.Zero, 0);
            report.truncated = true;
            return false;
        }

        private Owner InspectOwner(uint pid)
        {
            Owner cached;
            if (owners.TryGetValue(pid, out cached)) return cached;
            Owner owner = new Owner { status = "PROCESS_UNVERIFIED" };
            owners.Add(pid, owner);
            owner.handle = OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION only.
            if (owner.handle == IntPtr.Zero) return owner;
            StringBuilder image = new StringBuilder(32768);
            int size = image.Capacity;
            if (!QueryFullProcessImageName(owner.handle, 0, image, ref size)) return owner;
            owner.executable = Path.GetFileName(image.ToString()).ToUpperInvariant();
            if (owner.executable != "WINWORD.EXE" && owner.executable != "EXCEL.EXE" && owner.executable != "POWERPNT.EXE")
            { owner.status = "NOT_OFFICE"; return owner; }
            uint targetSession;
            if (!ProcessIdToSessionId(pid, out targetSession)) return owner;
            if (targetSession != sessionId) { owner.status = "FOREIGN"; report.foreignProcessesSkipped++; return owner; }
            IntPtr token;
            if (!OpenProcessToken(owner.handle, 0x0008, out token)) return owner; // TOKEN_QUERY only.
            try
            {
                int needed;
                GetTokenInformation(token, 1, IntPtr.Zero, 0, out needed); // TokenUser.
                if (needed < IntPtr.Size || needed > 65536) return owner;
                IntPtr data = Marshal.AllocHGlobal(needed);
                try
                {
                    if (!GetTokenInformation(token, 1, data, needed, out needed)) return owner;
                    string sid = new SecurityIdentifier(Marshal.ReadIntPtr(data)).Value;
                    if (sid != userSid) { owner.status = "FOREIGN"; report.foreignProcessesSkipped++; return owner; }
                    owner.sameUser = true;
                }
                finally { Marshal.FreeHGlobal(data); }
                data = Marshal.AllocHGlobal(4);
                try
                {
                    if (!GetTokenInformation(token, 20, data, 4, out needed)) return owner; // TokenElevation.
                    if (Marshal.ReadInt32(data) != 0) { owner.status = "ELEVATED_SKIPPED"; return owner; }
                }
                finally { Marshal.FreeHGlobal(data); }
                long created, exited, kernel, user;
                if (!GetProcessTimes(owner.handle, out created, out exited, out kernel, out user)) return owner;
                owner.instanceId = pid.ToString(CultureInfo.InvariantCulture) + ":" + created.ToString(CultureInfo.InvariantCulture);
                owner.status = "VERIFIED";
                return owner;
            }
            finally { CloseHandle(token); }
        }

        private static bool Current(Owner owner, uint pid, IntPtr root, IntPtr pane, string paneClass)
        {
            uint rootPid, panePid, exitCode;
            return GetExitCodeProcess(owner.handle, out exitCode) && exitCode == 259 &&
                GetWindowThreadProcessId(root, out rootPid) != 0 && rootPid == pid &&
                GetWindowThreadProcessId(pane, out panePid) != 0 && panePid == pid && ClassOf(pane) == paneClass;
        }

        private object Property(object target, string name)
        {
            // Explicit Office LCID avoids Excel TYPE_E_INVDATAREAD under invariant culture.
            object value = target.GetType().InvokeMember(name, BindingFlags.GetProperty, null, target, null, CultureInfo.GetCultureInfo(1033));
            if (value != null && Marshal.IsComObject(value)) acquiredObjects.Add(value);
            return value;
        }
        private string TextProperty(object target, string name)
        {
            string value = Convert.ToString(Property(target, name), CultureInfo.InvariantCulture);
            if (value.Length > 32768) throw new InvalidOperationException("METADATA_LIMIT");
            return value;
        }
        private string RetainKey(object value, Owner owner)
        {
            // Keep every acquired IUnknown reference until the snapshot is finished.
            // Pointer reuse cannot merge a closed window into an earlier identity.
            IntPtr identity = Marshal.GetIUnknownForObject(value);
            retainedIdentities.Add(identity);
            return owner.instanceId + ":" + identity.ToInt64().ToString("X", CultureInfo.InvariantCulture);
        }

        private void VisitPane(Owner owner, uint pid, IntPtr root, IntPtr pane)
        {
            string paneClass = ClassOf(pane);
            string kind = KindFor(owner.executable, paneClass);
            if (kind == null || !panes.Add(pane)) return;
            if (report.candidatesVisited >= maxCandidates) { report.truncated = true; return; }
            report.candidatesVisited++;
            owner.candidates++;
            if (!Current(owner, pid, root, pane, paneClass)) { Note("WINDOW_CHANGED", pid, pane, 0); return; }
            uint ignored;
            Evidence evidence = new Evidence { topLevelHwnd = HandleText(root), paneHwnd = HandleText(pane),
                paneClass = paneClass, threadId = GetWindowThreadProcessId(pane, out ignored),
                topLevelVisible = IsWindowVisible(root), topLevelMinimized = IsIconic(root) };
            object native = null;
            try
            {
                Guid dispatch = new Guid("00020400-0000-0000-C000-000000000046");
                int hr = AccessibleObjectFromWindow(pane, 0xFFFFFFF0, ref dispatch, out native); // OBJID_NATIVEOM.
                if (native != null && Marshal.IsComObject(native)) acquiredObjects.Add(native);
                if (hr != 0 || native == null) { Note("NATIVEOM_UNAVAILABLE", pid, pane, hr); return; }
                if (!Current(owner, pid, root, pane, paneClass)) { Note("WINDOW_CHANGED", pid, pane, 0); return; }
                string key = RetainKey(native, owner);
                DocumentWindow existing;
                if (windows.TryGetValue(key, out existing)) { existing.evidence.Add(evidence); return; }
                DocumentWindow item = new DocumentWindow { kind = kind, processId = pid, instanceId = owner.instanceId,
                    windowId = report.workerId + ":window:" + (windows.Count + 1), status = "native-window-accessible" };
                item.evidence.Add(evidence);
                windows.Add(key, item);
                report.windows.Add(item);
                try
                {
                    object application = Property(native, "Application");
                    if (application == null || !Marshal.IsComObject(application)) throw new InvalidOperationException("NO_APPLICATION");
                    string appKey = RetainKey(application, owner);
                    string appId;
                    if (!applications.TryGetValue(appKey, out appId))
                    {
                        appId = report.workerId + ":application:" + (applications.Count + 1);
                        applications.Add(appKey, appId);
                    }
                    item.applicationAccessible = true;
                    item.applicationId = appId;
                }
                catch (Exception error)
                {
                    Exception cause = error is TargetInvocationException && error.InnerException != null ? error.InnerException : error;
                    Note("APPLICATION_UNAVAILABLE", pid, pane, cause.HResult);
                }
                // Never use Application.ActiveDocument/ActiveWorkbook/ActiveWindow as a fallback.
                object doc = Property(native, kind == "word" ? "Document" : kind == "powerpoint" ? "Presentation" : "Parent");
                if (doc == null || !Marshal.IsComObject(doc)) throw new InvalidOperationException("NO_DOCUMENT");
                string docKey = RetainKey(doc, owner);
                string docId;
                if (!documents.TryGetValue(docKey, out docId))
                {
                    docId = report.workerId + ":document:" + (documents.Count + 1);
                    documents.Add(docKey, docId);
                }
                // Read into locals so partial failures do not imply verified metadata.
                string name = TextProperty(doc, "Name");
                string fullName = TextProperty(doc, "FullName");
                string location = TextProperty(doc, "Path");
                if (!Current(owner, pid, root, pane, paneClass)) { item.status = "window-changed"; Note("WINDOW_CHANGED", pid, pane, 0); return; }
                item.documentId = docId; item.name = name; item.fullName = fullName; item.path = location;
                item.status = "document-accessible";
            }
            catch (Exception error)
            {
                Exception cause = error is TargetInvocationException && error.InnerException != null ? error.InnerException : error;
                Note("NATIVEOM_OR_METADATA_FAILED", pid, pane, cause.HResult);
            }
        }

        private bool VisitRoot(IntPtr root, IntPtr unused)
        {
            if (!Budget()) return false;
            if (report.topLevelsVisited >= maxTopLevels) { report.truncated = true; return false; }
            report.topLevelsVisited++;
            uint pid;
            if (GetWindowThreadProcessId(root, out pid) == 0) return true;
            Owner owner = InspectOwner(pid);
            if (owner.status == "NOT_OFFICE" || owner.status == "FOREIGN") return true;
            owner.roots++;
            if (owner.status != "VERIFIED")
            {
                string rootClass = ClassOf(root);
                if (owner.executable == "WINWORD.EXE" || owner.executable == "EXCEL.EXE" || owner.executable == "POWERPNT.EXE" ||
                    rootClass == "OpusApp" || rootClass == "XLMAIN" || rootClass == "PPTFrameClass")
                {
                    if (!owner.diagnosed) Note(owner.status, pid, root, 0);
                    owner.diagnosed = true;
                }
                return true;
            }
            if (IsHungAppWindow(root)) { Note("HUNG_WINDOW_SKIPPED", pid, root, 0); return true; }
            int visited = 0;
            bool childLimit = false;
            VisitPane(owner, pid, root, root);
            EnumChildWindows(root, delegate(IntPtr pane, IntPtr parameter)
            {
                if (!Budget()) return false;
                if (report.childrenVisited >= maxChildren || visited >= 1024 || report.candidatesVisited >= maxCandidates)
                { childLimit = true; report.truncated = true; return false; }
                report.childrenVisited++; visited++;
                VisitPane(owner, pid, root, pane);
                return true;
            }, IntPtr.Zero);
            if (childLimit) Note("CHILD_OR_CANDIDATE_LIMIT", pid, root, 0);
            return Budget() && report.candidatesVisited < maxCandidates;
        }

        public static Report Scan(int candidates, int topLevels, int children, int deadlineMs)
        {
            ValidateLimits(candidates, topLevels, children, deadlineMs);
            if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA) throw new InvalidOperationException("STA_REQUIRED");
            Probe probe = new Probe { maxCandidates = candidates, maxTopLevels = topLevels, maxChildren = children, softDeadlineMs = deadlineMs };
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent()) { probe.userSid = identity.User.Value; }
            if (!ProcessIdToSessionId(GetCurrentProcessId(), out probe.sessionId)) throw new InvalidOperationException("SESSION_UNVERIFIED");
            try
            {
                bool completed = EnumWindows(probe.VisitRoot, IntPtr.Zero);
                if (!completed)
                {
                    probe.report.truncated = true;
                    probe.Note("ENUMERATION_INCOMPLETE", 0, IntPtr.Zero, 0);
                }
                foreach (KeyValuePair<uint, Owner> entry in probe.owners)
                {
                    Owner owner = entry.Value;
                    if (!owner.sameUser) continue;
                    probe.report.instances.Add(new Instance { processId = entry.Key, executable = owner.executable,
                        instanceId = owner.instanceId, status = owner.status, topLevelWindows = owner.roots,
                        nativePaneCandidates = owner.candidates });
                    if (owner.status == "VERIFIED" && owner.candidates == 0)
                        probe.Note(probe.report.truncated ? "NATIVE_PANES_NOT_OBSERVED_IN_PARTIAL_SCAN" : "NO_SUPPORTED_NATIVE_PANE", entry.Key, IntPtr.Zero, 0);
                }
                probe.report.elapsedMs = probe.clock.ElapsedMilliseconds;
                return probe.report;
            }
            finally
            {
                foreach (IntPtr identity in probe.retainedIdentities) Marshal.Release(identity);
                for (int i = probe.acquiredObjects.Count - 1; i >= 0; i--)
                {
                    try { Marshal.ReleaseComObject(probe.acquiredObjects[i]); }
                    catch (InvalidComObjectException) { }
                }
                foreach (Owner owner in probe.owners.Values) if (owner.handle != IntPtr.Zero) CloseHandle(owner.handle);
            }
        }

        // Reacquire only a previously observed pane after checking its owner and
        // process creation identity again. The caller owns the returned COM RCW.
        public static object OpenVerifiedWindow(DocumentWindow observed)
        {
            if (observed == null || observed.status != "document-accessible" || observed.evidence.Count == 0)
                throw new InvalidOperationException("DOCUMENT_WINDOW_UNVERIFIED");
            if (Thread.CurrentThread.GetApartmentState() != ApartmentState.STA)
                throw new InvalidOperationException("STA_REQUIRED");
            Probe probe = new Probe();
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent()) { probe.userSid = identity.User.Value; }
            if (!ProcessIdToSessionId(GetCurrentProcessId(), out probe.sessionId))
                throw new InvalidOperationException("SESSION_UNVERIFIED");
            try
            {
                Owner owner = probe.InspectOwner(observed.processId);
                if (owner.status != "VERIFIED" || owner.instanceId != observed.instanceId)
                    throw new InvalidOperationException("INSTANCE_CHANGED");
                Evidence evidence = observed.evidence[0];
                IntPtr root = new IntPtr(Convert.ToInt64(evidence.topLevelHwnd.Substring(2), 16));
                IntPtr pane = new IntPtr(Convert.ToInt64(evidence.paneHwnd.Substring(2), 16));
                if (KindFor(owner.executable, evidence.paneClass) != observed.kind ||
                    !Current(owner, observed.processId, root, pane, evidence.paneClass))
                    throw new InvalidOperationException("WINDOW_CHANGED");
                Guid dispatch = new Guid("00020400-0000-0000-C000-000000000046");
                object native;
                int hr = AccessibleObjectFromWindow(pane, 0xFFFFFFF0, ref dispatch, out native);
                if (hr != 0 || native == null || !Current(owner, observed.processId, root, pane, evidence.paneClass))
                    throw new InvalidOperationException("NATIVEOM_UNAVAILABLE");
                return native;
            }
            finally
            {
                foreach (Owner owner in probe.owners.Values)
                    if (owner.handle != IntPtr.Zero) CloseHandle(owner.handle);
            }
        }
    }
}
