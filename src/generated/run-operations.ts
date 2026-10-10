export interface paths {
    "/v1/run-operations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Operations */
        get: operations["list_operations_v1_run_operations_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/run-operations/assigned": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Assigned */
        get: operations["assigned_v1_run_operations_assigned_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/run-operations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Operation */
        get: operations["get_operation_v1_run_operations__id__get"];
        /** Submit */
        put: operations["submit_v1_run_operations__id__put"];
        post?: never;
        /** Dismiss */
        delete: operations["dismiss_v1_run_operations__id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/run-operations/{id}/answer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Answer */
        post: operations["answer_v1_run_operations__id__answer_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/run-operations/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel */
        post: operations["cancel_v1_run_operations__id__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/run-operations/{id}/claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Claim */
        post: operations["claim_v1_run_operations__id__claim_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/run-operations/{id}/checkpoint": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Checkpoint */
        post: operations["checkpoint_v1_run_operations__id__checkpoint_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/run-operations/{id}/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Profile */
        post: operations["profile_v1_run_operations__id__profile_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/run-operations/{id}/prepared": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Prepared Model
         * @description The node prepared the model (LS5): list it and go on with it.
         */
        post: operations["prepared_model_v1_run_operations__id__prepared_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** Answer */
        Answer: {
            /**
             * Answer
             * @enum {string}
             */
            answer: "install" | "skip";
        };
        /** Checkpoint */
        Checkpoint: {
            /** Lease */
            lease: string;
            /** Step */
            step: string;
            /** Engine */
            engine?: string | null;
            /** Runtime */
            runtime?: string | null;
            /** Runtimestatus */
            runtimeStatus?: string | null;
            /** Install */
            install?: {
                [key: string]: unknown;
            } | null;
            preparation?: components["schemas"]["PreparationStatus"] | null;
            /** Error */
            error?: string | null;
            /** Failedstep */
            failedStep?: string | null;
            /** Loadingsince */
            loadingSince?: number | null;
        };
        /** ClaimedOperation */
        ClaimedOperation: {
            /** Id */
            id: string;
            /** Node */
            node: string | null;
            intent: components["schemas"]["Intent"];
            model: components["schemas"]["LibraryModel"] | null;
            /**
             * Step
             * @enum {string}
             */
            step: "downloading" | "checking" | "awaiting-install" | "installing" | "preparing" | "settings" | "launching" | "loading" | "ready" | "skipped" | "failed" | "cancelled";
            /** Engine */
            engine?: string | null;
            /** Runtime */
            runtime?: string | null;
            /** Runtimestatus */
            runtimeStatus?: string | null;
            download?: components["schemas"]["Download"] | null;
            /** Install */
            install?: {
                [key: string]: unknown;
            } | null;
            preparation?: components["schemas"]["PreparationStatus"] | null;
            /** @description The model a preparation started from; `model` is then the prepared one. */
            preparedFrom?: components["schemas"]["LibraryModel"] | null;
            profile?: components["schemas"]["ModelProfile"] | null;
            /** Error */
            error?: string | null;
            /** Failedstep */
            failedStep?: string | null;
            /** Answer */
            answer?: ("install" | "skip") | null;
            /** Startedat */
            startedAt: number;
            /** Finishedat */
            finishedAt?: number | null;
            /** Loadingsince */
            loadingSince?: number | null;
            /**
             * Dismissed
             * @default false
             */
            dismissed: boolean;
            /** Lease */
            lease: string;
            /** Leaseuntil */
            leaseUntil: number;
        };
        /**
         * Download
         * @description One transfer job over N files. Records persist after they finish;
         *     `DELETE` forgets one.
         */
        Download: {
            /** Id */
            id: string;
            state: components["schemas"]["DownloadState"];
            /** Repo */
            repo: string;
            /**
             * Source
             * @description The `hf_hub` source it fetches from (LS4). Absent on a record
             *     from before LS4, or when none was named: the first enabled
             *     `hf_hub` source.
             */
            source?: string | null;
            /** Revision */
            revision?: string | null;
            /**
             * Resolvedcommit
             * @description The commit this download is pinned to. A resume that finds
             *     upstream serving a different digest for the same path
             *     reports it here rather than appending new bytes to old ones.
             */
            resolvedCommit?: string | null;
            /** Root */
            root?: string | null;
            /**
             * Destinationdirectory
             * @description Absolute directory the files will land in, resolved **before
             *     the first byte moves** so the operator can see where their
             *     model is going while there is still time to change it.
             */
            destinationDirectory?: string | null;
            /** Files */
            files: components["schemas"]["DownloadFile"][];
            /** Bytestotal */
            bytesTotal?: number | null;
            /** Bytesdownloaded */
            bytesDownloaded?: number | null;
            /**
             * Bytespersecond
             * @description Recent rate, not an average over the whole job.
             */
            bytesPerSecond?: number | null;
            /** Etaseconds */
            etaSeconds?: number | null;
            /**
             * Attempts
             * @description How many times the transfer has been (re)started, including
             *     automatic retries. Visible because a 40 GB fetch over a
             *     domestic link will meet transient failures, and the
             *     difference between a flaky connection and a dead one is
             *     this number moving.
             */
            attempts?: number | null;
            /**
             * Modelid
             * @description The library entry this download became, filled in after the
             *     post-completion scan of the destination directory. This is
             *     what closes discovery → download → library → profile →
             *     launch without the UI polling for a model to appear.
             */
            modelId?: string | null;
            /** Startedat */
            startedAt?: string | null;
            /** Finishedat */
            finishedAt?: string | null;
            /** Error */
            error?: string | null;
            /**
             * Errorcode
             * @description Upstream's own error code when it gave one — `GatedRepo` is
             *     the one that will actually happen, and it means "accept the
             *     licence on the model page" rather than anything the operator
             *     can fix here. Carried through so the UI can say that instead
             *     of surfacing a bare 401.
             */
            errorCode?: string | null;
            /**
             * Restartedfromzero
             * @description True when a resume found the remote file had changed and
             *     discarded the partial. Surfaced rather than silent: the
             *     operator is about to re-spend bandwidth they already spent,
             *     and the reason is that upstream requantized under the same
             *     filename.
             */
            restartedFromZero?: boolean | null;
            /**
             * Message
             * @description What the current phase is doing, for the progress dialog.
             */
            message?: string | null;
        };
        /** DownloadFile */
        DownloadFile: {
            /**
             * Path
             * @description Repo-relative source path.
             */
            path: string;
            /**
             * Destinationpath
             * @description Absolute path this file will occupy when it is done. While
             *     it is in flight the bytes live at this path plus `.part`.
             */
            destinationPath: string;
            /** Sizebytes */
            sizeBytes?: number | null;
            /** Bytesdownloaded */
            bytesDownloaded?: number | null;
            state: components["schemas"]["DownloadState"];
            /**
             * Sha256
             * @description Expected content digest, when upstream published one.
             */
            sha256?: string | null;
            /**
             * Verified
             * @description Whether the finished file matched its digest. Verification
             *     happens **before** the `.part` is renamed into place, so a
             *     file that exists at `destinationPath` was verified — and one
             *     that failed stays a `.part` with the record in `failed`,
             *     never silently retried into the same bytes.
             */
            verified?: boolean | null;
            role?: components["schemas"]["ModelFileRole"] | null;
            /** Error */
            error?: string | null;
        };
        /**
         * DownloadSpec
         * @description What to fetch and where to put it. The file list is explicit
         *     rather than inferred from the repo: "download the model" has to
         *     mean something exact by the time it reaches the transfer loop,
         *     and the catalogue detail response has already grouped the repo
         *     into candidates whose `files` can be passed straight through.
         */
        DownloadSpec: {
            /**
             * Repo
             * @description Upstream repo id.
             */
            repo: string;
            /**
             * Source
             * @description The `hf_hub` source to fetch from (`CatalogueSource.id`, a
             *     search result's `hubSource`, LS4). Absent: the first enabled
             *     `hf_hub` source. Kept on the record, so a resume asks the same
             *     hub with the same token.
             */
            source?: string | null;
            /**
             * Revision
             * @description Resolved to a commit at start and pinned for the life of
             *     the download, so a resume days later fetches the same bytes
             *     it began with.
             * @default main
             */
            revision: string | null;
            /**
             * Files
             * @description Repo-relative paths. Every shard of a split candidate, the
             *     projector if the operator wants vision, and for safetensors
             *     the sidecars as well as the weights. Take these from
             *     `CatalogueCandidate.files` and `CatalogueModel.projectors`.
             */
            files: string[];
            /**
             * Root
             * @description Which configured model root to write under. Must be one of
             *     them — this component will not write outside the
             *     directories the operator nominated. Defaults to the first,
             *     which is what the `path_list` config type has promised
             *     since M2.
             */
            root?: string | null;
            /**
             * Subdirectory
             * @description Relative destination under `root`, overriding the configured
             *     layout. Path traversal is rejected; the result must stay
             *     inside the root.
             */
            subdirectory?: string | null;
            /**
             * Filename
             * @description Override the written name of the **single-file** case. Rarely
             *     wanted: the upstream name is what the operator recognises,
             *     what the library will call it, and what
             *     `Runtime.modelAlias` defaults to — plainly-named files are
             *     the point. Rejected when `files` holds more than one entry,
             *     because renaming one shard of a set breaks the set.
             */
            filename?: string | null;
        };
        /**
         * DownloadState
         * @description Named phases rather than a percentage, following M1's engine
         *     install for the same reason: the phases fail differently and the
         *     operator needs to know which one they are in. A stall in
         *     `downloading` is the network, a stall in `verifying` is the
         *     disk, and `verifying` *failing* is the one that means the bytes
         *     are wrong.
         *
         *     * `queued` — accepted, waiting on `maxConcurrentDownloads`.
         *     * `resolving` — asking upstream for the commit, sizes and
         *       digests. Where a gated repo's 401 surfaces.
         *     * `paused` — operator-stopped; the `.part` is kept and shows up
         *       in the next scan as `incomplete_download`.
         *     * `cancelled` — operator-abandoned; the `.part` is removed.
         *     * `failed` — the retry budget is spent. `resume` runs the same
         *       loop again.
         * @enum {string}
         */
        DownloadState: "queued" | "resolving" | "downloading" | "verifying" | "done" | "failed" | "paused" | "cancelled";
        /**
         * EngineKind
         * @description Which engine adapter constructs the argv and interprets
         *     readiness. Deliberately a closed enum rather than a free string:
         *     an engine is supported exactly when an adapter exists for it,
         *     and without an adapter there is nothing that knows how to start
         *     it or tell when it is ready.
         *
         *     `strata` is experimental. It launches Strata's Python HTTP
         *     server and native engine together, and loads a model Strata
         *     prepared (`ModelFormat` `prepared`): `RuntimeSpec.modelPath`
         *     names that model's provenance file (`PreparedProvenance`), whose
         *     `entry` is Strata's own JSON configuration. A runtime declared
         *     before LS3 may name the JSON configuration itself; that still
         *     launches. It does not accept an arbitrary GGUF, and does not yet
         *     prepare one itself (LS5).
         *
         *     `kev` drives upstream `python -m kev.serve` and loads Kev
         *     decision checkpoints (`kev_checkpoint` format) — a decision
         *     model, not a chat model: its server speaks the System One
         *     protocol and its companion driver serves `POST /v1/decide`,
         *     never completions. Like vLLM it loads the model *before*
         *     binding its port (read off `kev/serve.py` at the pinned commit
         *     and observed live 2026-09-22), so alive-and-refusing is
         *     `loading`; unlike every other engine it handles one request at
         *     a time, which its driver advertises as a concurrency limit.
         *     Its bind is hardcoded to loopback upstream, which is the
         *     posture Eugene wants: the gateway is the authenticated front
         *     door.
         *
         *     `llama_cpp` drives upstream `llama-server` and loads GGUF.
         *     `vllm` drives upstream `vllm serve` and loads safetensors.
         *     `mlx` drives upstream `mlx_lm.server` and loads MLX-format
         *     safetensors, on Apple silicon only; not experimental since its
         *     run on GitHub's macOS runners (A4, 2026-09-30). We never ship an engine — every
         *     one of them is an upstream project we wrap and track.
         *
         *     They differ in far more than argv, and that is why readiness
         *     is per-adapter rather than one shared TCP check:
         *     `llama-server` answers `/health` while it loads and reports that
         *     it is loading, whereas vLLM binds its port *before* loading the
         *     model and refuses connections until the model is in memory — so
         *     for minutes it is indistinguishable, over the network alone,
         *     from a process that died. `mlx_lm.server` is a third mechanism
         *     again and the most awkward: it serves HTTP immediately, and at
         *     the pinned release its `/health` answers a hardcoded
         *     `{"status": "ok"}` while the model is still loading on another
         *     thread, so **no read-only probe can tell loading from ready**.
         *     Its adapter proves residency by asking for one token, once per
         *     process, and only then treats the health endpoint as evidence.
         *     (Upstream `main` has since taught `/health` to answer 503
         *     `unavailable` while loading; the adapter reads that as loading
         *     too, so a future pin gets the cheap probe for free.) They
         *     differ in acquisition too: a llama.cpp build is fetched and
         *     verified by us, while vLLM and mlx-lm are Python packages the
         *     operator installs themselves. See `EngineAcquisition.policy`.
         *
         *     Lives here rather than on the agent because two components
         *     reference it: the agent's engines and runtimes, and a
         *     library `ModelProfile`, which names the engine its launch flags
         *     are written for.
         * @enum {string}
         */
        EngineKind: "llama_cpp" | "vllm" | "mlx" | "kev" | "strata";
        /**
         * GgufDetail
         * @description GGUF-specific metadata, read from the file's KV block. Present
         *     iff `format` is `gguf`.
         */
        GgufDetail: {
            /**
             * Quantization
             * @description Human-readable quant tier, e.g. `"Q4_K_M"`. The vocabulary
             *     the operator's question is actually phrased in — "Q3_K_S vs
             *     2Q_K_M? No one knows" — and M3's guidance hangs off it.
             */
            quantization?: string | null;
            /**
             * Filetype
             * @description Raw `general.file_type` enum value, reported alongside the
             *     label rather than instead of it. It **does** distinguish the
             *     K-quant mixtures (verified: 14 is `Q4_K_S`, 15 is `Q4_K_M`),
             *     so the label is machine-read rather than guessed from a
             *     filename.
             *
             *     Reported raw because the quant families churn — imatrix
             *     variants, MXFP4, whatever is next — and a reader will meet
             *     values it does not know. The rule for those is to surface
             *     the number and the filename-derived label, never to map an
             *     unrecognised value onto a plausible neighbour: guidance
             *     built on a guess is worse than no guidance.
             */
            fileType?: number | null;
            /**
             * Quantizationdisagrees
             * @description True when the label derived from `fileType` and the label in
             *     the filename are not the same. Both are then reported and
             *     neither is silently preferred, because either one can be the
             *     wrong one — a requantized file keeps its old name more often
             *     than a metadata field is wrong, but not always.
             */
            quantizationDisagrees?: boolean | null;
            /**
             * Ggufversion
             * @description GGUF container version (3 for everything current).
             */
            ggufVersion?: number | null;
            /**
             * Shardcount
             * @description Number of `…-0000N-of-0000M.gguf` parts. 1 for a plain file.
             *     Only the first is on the launch line; the rest are `shard`
             *     files.
             */
            shardCount?: number | null;
            /**
             * Vocabsize
             * @description Token count. Worth reporting for its own sake and because it
             *     explains the scan cost: the tokenizer lives in the KV block,
             *     so a 248k-token vocab means ~10.9 MB of metadata to walk
             *     past before the quant can be read.
             */
            vocabSize?: number | null;
            /**
             * Expertbytes
             * @description Bytes of mixture-of-experts expert tensors (names carrying
             *     `_exps`), summed from the tensor table that follows the KV
             *     block: names, shapes and offsets, never a weight. 0 for a
             *     dense model. Null when the table was not read (a scan from
             *     before 2026-09-30, or a header cut short).
             *
             *     The number that tells a MoE model from a dense one of the
             *     same size: on Qwen3-30B-A3B Q4_K_M it is 16.35 GiB of 17.28,
             *     and everything else is 0.93 GiB, so a small card holds all of
             *     that plus the cache and llama.cpp moves only experts to system
             *     memory (`docs/design/moe-aware-fit.md` §0).
             */
            expertBytes?: number | null;
            /**
             * Projectorpath
             * @description Absolute path to the vision projector found beside this
             *     model, if any. Becomes `--mmproj` on the launch line.
             *     llama-server can also find it unaided, but it is reported
             *     because "this model can see" is a fact the browser should
             *     show and a profile should be able to override.
             */
            projectorPath?: string | null;
            recommendedSampling?: components["schemas"]["RecommendedSampling"] | null;
            /**
             * Metadata
             * @description Selected raw KV pairs, verbatim, minus the tokenizer arrays.
             *     An escape hatch for the long tail — architecture-prefixed
             *     keys grow with upstream, and a reader that only ever exposes
             *     the fields it was written to understand goes blind on every
             *     model newer than itself.
             */
            metadata?: {
                [key: string]: unknown;
            } | null;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** Intent */
        Intent: {
            /** Node */
            node?: string | null;
            /** Modelid */
            modelId?: string | null;
            download?: components["schemas"]["DownloadSpec"] | null;
            preparation?: components["schemas"]["PreparationIntent"] | null;
        };
        /**
         * KevCheckpointDetail
         * @description Kev-checkpoint-specific metadata. Present iff `format` is
         *     `kev_checkpoint`. The point of recording it is
         *     reproducibility: a checkpoint is only half a runnable model —
         *     the loader downloads the named base separately — so an operator
         *     restoring a node offline needs to know exactly which base
         *     weights, at which revision, the launch will ask for. The
         *     adapter, decision head, tokenizer and calibration/provenance
         *     files are all in `files` with their roles; the license rides the
         *     checkpoint's own metadata on disk.
         */
        KevCheckpointDetail: {
            /**
             * Basemodel
             * @description The base weights the adapter applies to, as
             *     `adapter_config.json` names them (e.g.
             *     `Qwen/Qwen3.5-0.8B-Base`). The half of the model this
             *     directory does NOT contain.
             */
            baseModel?: string | null;
            /**
             * Repoid
             * @description HuggingFace repo this came from, when the layout says so.
             */
            repoId?: string | null;
            /**
             * Revision
             * @description Snapshot revision, when the checkpoint sits in a HF cache.
             */
            revision?: string | null;
        };
        /**
         * LibraryModel
         * @description One launchable model on this host.
         *
         *     The format-independent facts are here; exactly one of `gguf`,
         *     `safetensors`, `kev` or `prepared` carries the rest. That split is not tidiness — a
         *     quant tier is a GGUF concept and an exact parameter count is a
         *     safetensors one, and flattening both into one object would
         *     produce a schema half of whose fields are null for any given
         *     model.
         */
        LibraryModel: {
            /**
             * Id
             * @description Stable handle for this model: the first 16 hex characters of
             *     the SHA-256 of its normalized absolute path. Normalized
             *     means absolute, canonical separators, case-folded on
             *     Windows, and **symlinks left unresolved**.
             *
             *     Derived rather than random so it survives restarts, since
             *     profiles are keyed to it. **Opaque to callers** — the
             *     normalization rules are fiddly enough that a client deriving
             *     it independently would sooner or later compute a handle the
             *     server does not recognise and get an unexplained 404. Use
             *     `GET /v1/models?path=` instead.
             *
             *     Not content addressing: no byte of the model is read to
             *     produce it. Hashing 40 GB on every scan is not on the table,
             *     and a content-derived identity would change when nothing the
             *     operator did changed.
             */
            id: string;
            /**
             * Path
             * @description Absolute path, verbatim, in the operator's own layout — the
             *     model's real identity, reported in full because the `id` is
             *     not human-readable and nothing here should be hidden behind
             *     a handle.
             *
             *     A `.gguf` file for GGUF (the **first** shard when split), a
             *     directory for safetensors, the provenance file
             *     (`<name>.eugene-prepared.json`) for `prepared`. This is what
             *     goes on a runtime's `modelPath`.
             *
             *     **A path on the host this library runs on** — inside its
             *     container, if it runs in one. A node that runs the engine
             *     elsewhere reaches the same file through its agent's
             *     `pathMappings` (M11): the declaration keeps this spelling,
             *     and the node resolves its own at every spawn. So this string
             *     is both the model's identity install-wide and the left-hand
             *     side of any mapping that reaches it.
             */
            path: string;
            /**
             * Root
             * @description The configured root this model was found under. Two roots
             *     can hold the same filename, so this is how the UI
             *     disambiguates two entries that otherwise read alike — and
             *     how it tells the operator which drive to go plug back in.
             */
            root?: string | null;
            format: components["schemas"]["ModelFormat"];
            /**
             * Name
             * @description The filename with its extension stripped, the directory
             *     name for safetensors, or the provenance file's name without
             *     `.eugene-prepared.json` for `prepared`. **Not derived from metadata**: the
             *     file's own name is what the operator downloaded, what they
             *     call it, and what `Runtime.modelAlias` defaults to — so
             *     plainly-named files mean the obvious name is already the
             *     right one.
             */
            name: string;
            /**
             * Displayname
             * @description The model's self-declared name from its metadata
             *     (`general.name` for GGUF), when it has one and it differs
             *     from `name`. Shown as a subtitle, never as the identity:
             *     metadata names are frequently the training-run name and
             *     collide across quants of one model.
             */
            displayName?: string | null;
            status: components["schemas"]["ModelStatus"];
            /**
             * Sizebytes
             * @description Total size of every file belonging to this model — all
             *     shards, and the projector when there is one. The number
             *     that answers "will this fit on the drive I am copying it
             *     to", which is why it is a sum rather than the weights file
             *     alone.
             *
             *     Absent for `prepared`: the engine's own files are not read,
             *     so their size is not known, and the provenance file's few
             *     bytes are not the model's size.
             */
            sizeBytes?: number | null;
            /**
             * Filecount
             * @description How many files make up this model. 1 for a plain single-file GGUF.
             */
            fileCount?: number | null;
            /**
             * Architecture
             * @description Model architecture as the file declares it — `general.architecture`
             *     for GGUF, `model_type` from `config.json` for safetensors.
             *     Free-form on purpose: new architectures ship constantly and
             *     an enum here would reject models that work fine.
             */
            architecture?: string | null;
            /**
             * Contextlength
             * @description Context length the **model** declares. Not what an engine
             *     will serve — that depends on the launch flags and available
             *     memory, and is reported by the agent as
             *     `RuntimeCapabilities.contextLength`. Both numbers are real
             *     and a UI that shows only this one tells a comfortable lie.
             */
            contextLength?: number | null;
            /**
             * Parameters
             * @description Exact parameter count, when the format gives one. Safetensors
             *     headers do (summed tensor shapes, from an ~11 KB read);
             *     **GGUF does not** — see `sizeLabel`. Optional because for
             *     most local models it is genuinely unavailable, and a schema
             *     that required it would be unfillable for every GGUF in
             *     existence.
             */
            parameters?: number | null;
            /**
             * Sizelabel
             * @description The author's own size label, e.g. `"27B"`
             *     (`general.size_label`). A display string, not a number, and
             *     not always present or accurate — it is what the person who
             *     uploaded the file typed. For GGUF it is usually the only
             *     answer available to "how big is this model".
             */
            sizeLabel?: string | null;
            capabilities?: components["schemas"]["ModelCapabilities"] | null;
            /**
             * Files
             * @description Every file that belongs to this model, with its role. This
             *     is what makes a sharded model legible as one thing, and what
             *     shows the operator that the 900 MB projector next to their
             *     model is accounted for rather than missed.
             */
            files?: components["schemas"]["ModelFile"][] | null;
            gguf?: components["schemas"]["GgufDetail"] | null;
            safetensors?: components["schemas"]["SafetensorsDetail"] | null;
            kev?: components["schemas"]["KevCheckpointDetail"] | null;
            prepared?: components["schemas"]["PreparedDetail"] | null;
            /**
             * Profilecount
             * @description How many launch profiles are saved against this model. On
             *     the list so the browser can badge a tuned model without
             *     fetching every profile collection.
             */
            profileCount?: number | null;
            /**
             * Firstseenat
             * @description When a scan first found this model.
             */
            firstSeenAt?: string | null;
            /**
             * Lastseenat
             * @description When a scan last found it on disk. For a `missing` entry
             *     this is when it was last there, which is the only clue to
             *     what happened.
             */
            lastSeenAt?: string | null;
            /**
             * Modifiedat
             * @description Filesystem mtime of the weights. Part of the incremental-rescan key.
             */
            modifiedAt?: string | null;
            /**
             * Error
             * @description Why this entry is `unreadable` — a header that would not
             *     parse, a permission error, a truncated file. Named rather
             *     than dropped: a model the operator can see and we cannot
             *     explain is the worst of the three states.
             */
            error?: string | null;
        };
        /**
         * MlxQuantization
         * @description Present when the directory's `config.json` carries an MLX-style
         *     top-level `quantization` block — the marker `mlx_lm.convert`
         *     writes and the one signal that distinguishes an MLX-converted
         *     directory from a vanilla HF safetensors export (which spells
         *     its quantization `quantization_config`, a different key).
         *     Load-bearing for engine choice, because **safetensors alone
         *     does not prove MLX compatibility** and an MLX-quantized
         *     directory packs its weights as integer tensors that no other
         *     engine here can load.
         *
         *     One honest caveat, recorded rather than papered over: an
         *     *unquantized* MLX conversion carries no such block and reads as
         *     a plain safetensors directory — absence means unknown, not
         *     incompatible. `parameters` for an MLX-quantized directory is the
         *     model's parameter count, recovered from the packed storage (each
         *     quantized module holds its `scales` times its group size); it
         *     is absent when a group size cannot be read. Until A4
         *     (2026-09-30) it counted packed storage elements instead, which
         *     read a 0.6B model as 93M.
         */
        MlxQuantization: {
            /**
             * Bits
             * @description Bits per weight, as the block declares it (e.g. 4).
             */
            bits?: number | null;
            /**
             * Groupsize
             * @description Quantization group size (`group_size`), when declared.
             */
            groupSize?: number | null;
        };
        /**
         * ModelCapabilities
         * @description What the model's own metadata says it can do. Distinct from the
         *     agent's `RuntimeCapabilities`, which is read back off a
         *     *running* engine: this is a property of the file, available
         *     before anything is launched, and it is what the launch flags
         *     have to be chosen from.
         */
        ModelCapabilities: {
            /**
             * Chat
             * @description Text generation — the default assumption for a causal model.
             *     False for an embedding model.
             */
            chat?: boolean | null;
            /**
             * Embedding
             * @description The model is a dedicated embedding model (a pooling type in
             *     its metadata, or non-causal attention). Load-bearing rather
             *     than informational: llama-server's own help says
             *     `--embedding` is "for use only with dedicated embedding
             *     models", and launching one of these as a chat model does not
             *     fail — it starts, serves, and returns nonsense.
             */
            embedding?: boolean | null;
            /**
             * Vision
             * @description A vision projector was found for this model, so it can take
             *     images. See `GgufDetail.projectorPath`.
             */
            vision?: boolean | null;
            /**
             * Chattemplate
             * @description The file embeds its own chat template. When false, something
             *     has to supply one at launch, and a model answering strangely
             *     with no template is a common and confusing failure.
             */
            chatTemplate?: boolean | null;
            /**
             * Decision
             * @description A decision model: it answers typed questions with structured
             *     probabilities through `POST /v1/systemone`, and it does not
             *     chat — `chat` is false whenever this is true, and offering
             *     it a conversation fails clearly instead of producing prose.
             *     True for a `kev_checkpoint`.
             */
            decision?: boolean | null;
        };
        /**
         * ModelFile
         * @description One file belonging to a model, and what part it plays.
         */
        ModelFile: {
            /**
             * Path
             * @description Absolute path.
             */
            path: string;
            role: components["schemas"]["ModelFileRole"];
            /** Sizebytes */
            sizeBytes?: number | null;
        };
        /**
         * ModelFileRole
         * @description * `weights` — the file named on the launch line. Exactly one per
         *       model: the single `.gguf`, the first shard of a split one, or
         *       the primary safetensors file.
         *     * `shard` — the second through Nth part of a split model.
         *     * `projector` — a vision projector (`general.type: mmproj`),
         *       which is why it is a role here and not a model of its own.
         *     * `config` / `tokenizer` / `index` — safetensors sidecars.
         *     * `other` — present in the model's directory, counted in
         *       `sizeBytes`, not classified.
         * @enum {string}
         */
        ModelFileRole: "weights" | "shard" | "projector" | "config" | "tokenizer" | "index" | "other";
        /**
         * ModelFormat
         * @description On-disk format of a model. A dimension of the data model rather
         *     than an assumption (locked 2026-09-08), and the differences are
         *     load-bearing rather than cosmetic.
         *
         *     * `gguf` — a single file, quantized, carrying its own metadata
         *       and tokenizer. Large models may be **split** into
         *       `…-00001-of-0000N.gguf` shards, of which only the first is
         *       named on a launch line. A multimodal GGUF ships its vision
         *       projector as a separate file in the same directory, which is
         *       not itself a model.
         *     * `safetensors` — a directory: `config.json` plus one or more
         *       weight files plus tokenizer files. Unquantized in practice,
         *       so **no quant tier** — a safetensors model is sized, not
         *       tiered, and the quant fields exist only on the GGUF side.
         *     * `kev_checkpoint` — a directory holding a rank-limited LoRA
         *       adapter (`adapter_config.json` + `adapter_model.safetensors`),
         *       a pointer/decision head (`head.pt`), tokenizer files and
         *       calibration/provenance artifacts (`provenance.json`), loaded
         *       by Kev's own loader on top of a separately downloaded base
         *       model named in the adapter config. Measured off the published
         *       `jaredpalmer/kev-0.8b` checkpoint on 2026-09-22. **Not an
         *       ordinary adapter**: a plain LoRA directory is skipped by the
         *       scanner on purpose, and the decision head is what makes this
         *       one a launchable model instead. Decision-only —
         *       `ModelCapabilities.decision`, never `chat`.
         *     * `prepared` — what one engine made for itself from another
         *       model, in the engine's own format: Strata's expert pack,
         *       lookup table and MTP helper, with its JSON configuration
         *       (library-sources-and-engines.md §4.5, Troy's L6). The library
         *       does not read the engine's files; a small provenance file
         *       beside them, `<name>.eugene-prepared.json`
         *       (`PreparedProvenance`), names the engine, its entry file and
         *       what it was made from, and is the model's path. Only the
         *       engine it was prepared for loads it
         *       (`ModelRequirement.preparedFor`).
         *
         *     Shared because it appears on both sides of a join: a library
         *     entry declares what a model *is*, and an engine's
         *     `ModelRequirement`s declare what it can *load*. The format is
         *     the first term of that join, not the whole of it
         *     (library-sources-and-engines.md).
         * @enum {string}
         */
        ModelFormat: "gguf" | "safetensors" | "kev_checkpoint" | "prepared";
        /**
         * ModelProfile
         * @description A saved profile, as stored: the spec plus server-owned
         *     identifiers and timestamps.
         */
        ModelProfile: {
            /**
             * Id
             * @description Server-assigned profile id, unique within the model.
             */
            id: string;
            /** Name */
            name: string;
            /** Default */
            default: boolean;
            /** Maxtokens */
            maxTokens?: number | null;
            /** Temperature */
            temperature?: number | null;
            /** Topp */
            topP?: number | null;
            engine: components["schemas"]["EngineKind"];
            /** Flags */
            flags?: {
                [key: string]: unknown;
            } | null;
            /** Extraargs */
            extraArgs?: string[] | null;
            /** Env */
            env?: {
                [key: string]: string;
            } | null;
            /** Notes */
            notes?: string | null;
            /** @description The settings builder's record, when it wrote this profile. Kept by a replace that omits it. */
            builtBy?: components["schemas"]["ProfileBuiltBy"] | null;
            /** Createdat */
            createdAt?: string | null;
            /** Updatedat */
            updatedAt?: string | null;
        };
        /**
         * ModelStatus
         * @description * `present` — found on disk and readable.
         *     * `missing` — not found by the last scan, but profiles are
         *       saved against it, so the entry survives. **Moving a model
         *       produces this**, plus a new entry at the new path: nothing
         *       guesses that a file which vanished from one root and appeared
         *       in another is the same file, because a wrong guess silently
         *       applies one model's tuning to another. The profiles stay here
         *       to be copied across by hand.
         *     * `unreadable` — the files are there and something about them
         *       did not work. `error` says what.
         * @enum {string}
         */
        ModelStatus: "present" | "missing" | "unreadable";
        /**
         * Operation
         * @description HTTP view; the journal envelope has its own version and schema.
         */
        Operation: {
            /** Id */
            id: string;
            /** Node */
            node: string | null;
            intent: components["schemas"]["Intent"];
            model: components["schemas"]["LibraryModel"] | null;
            /**
             * Step
             * @enum {string}
             */
            step: "downloading" | "checking" | "awaiting-install" | "installing" | "preparing" | "settings" | "launching" | "loading" | "ready" | "skipped" | "failed" | "cancelled";
            /** Engine */
            engine?: string | null;
            /** Runtime */
            runtime?: string | null;
            /** Runtimestatus */
            runtimeStatus?: string | null;
            download?: components["schemas"]["Download"] | null;
            /** Install */
            install?: {
                [key: string]: unknown;
            } | null;
            preparation?: components["schemas"]["PreparationStatus"] | null;
            /** @description The model a preparation started from; `model` is then the prepared one. */
            preparedFrom?: components["schemas"]["LibraryModel"] | null;
            profile?: components["schemas"]["ModelProfile"] | null;
            /** Error */
            error?: string | null;
            /** Failedstep */
            failedStep?: string | null;
            /** Answer */
            answer?: ("install" | "skip") | null;
            /** Startedat */
            startedAt: number;
            /** Finishedat */
            finishedAt?: number | null;
            /** Loadingsince */
            loadingSince?: number | null;
            /**
             * Dismissed
             * @default false
             */
            dismissed: boolean;
        };
        /** OperationList */
        OperationList: {
            /** Operations */
            operations: components["schemas"]["Operation"][];
        };
        /**
         * PreparationIntent
         * @description Prepare the model for an engine before running it (LS5). Asked for,
         *     never implied: Run without it picks an engine that runs the model as it is.
         */
        PreparationIntent: {
            engine: components["schemas"]["EngineKind"];
            /**
             * Contextsize
             * @description The context the engine prepares for. Absent: the engine's own recommendation for the node.
             */
            contextSize?: number | null;
        };
        /**
         * PreparationStatus
         * @description Where a preparation is, as the engine's node reports it (LS5).
         */
        PreparationStatus: {
            /**
             * State
             * @enum {string}
             */
            state: "waiting" | "running" | "done" | "failed" | "cancelled";
            /**
             * Step
             * @description The recipe's own words for where it is.
             */
            step?: string | null;
            /**
             * Message
             * @description Its last line of output.
             */
            message?: string | null;
            /**
             * Byteswritten
             * @description What it has written beside the model so far.
             */
            bytesWritten?: number | null;
            /**
             * Bytesneeded
             * @description What it expects to write in all, when known.
             */
            bytesNeeded?: number | null;
            /**
             * Warnings
             * @description What the engine's own tools warned about.
             */
            warnings?: string[];
        };
        /**
         * PreparedDetail
         * @description A prepared model's provenance, as its file
         *     (`PreparedProvenance`) says it, and what the library made of it.
         *     Present iff `format` is `prepared` and the file could be read.
         *
         *     The library does not read the engine's own files
         *     (experimental-engines.md: prepared files stay usable without the
         *     library parsing them). What it knows of a prepared model (LS7,
         *     B22 replaced: the Library imparts what is known and names what is
         *     not) is what the engine's adapter read off those files when it
         *     was prepared or added and the provenance file records (`title`,
         *     `contextLength`, `mode`, `files`), measured on this host; what it
         *     inherits from the model it was made from when the library lists
         *     that (`LibraryModel.architecture`, `parameters`, `sizeLabel`);
         *     and in `missing`, each fact it cannot give, with why. Fit is the
         *     engine's own (LS6). `LibraryModel.files` lists the provenance
         *     file (`index`), the entry file (`config`) and the files it
         *     records, and `LibraryModel.sizeBytes` is `diskBytes`.
         */
        PreparedDetail: {
            engine: components["schemas"]["EngineKind"];
            /**
             * Entry
             * @description The entry file as the provenance file writes it.
             */
            entry: string;
            /**
             * Entrypath
             * @description `entry` resolved against the folder holding the provenance
             *     file, on this library's host; the same as `entry` when that
             *     is absolute.
             */
            entryPath?: string | null;
            /**
             * Entryfound
             * @description Whether this library's host sees the entry file. A relative
             *     entry that is not there makes the model `unreadable`. An
             *     absolute entry not seen here is not an error: it is a path on
             *     the node that runs the model (an engine's prepared files
             *     belong on that node's own fast drive, which only its agent
             *     sees), and the agent checks it when the model starts, naming
             *     any missing file.
             */
            entryFound?: boolean | null;
            /**
             * Recipe
             * @description As `PreparedProvenance.recipe`; absent means prepared outside Eugene.
             */
            recipe?: string | null;
            /** Recipeversion */
            recipeVersion?: string | null;
            source?: components["schemas"]["PreparedSource"] | null;
            /**
             * Sourcemodelid
             * @description The library model it was prepared from, when `source.path`
             *     names one this library lists. Absent when it does not, or
             *     names none.
             */
            sourceModelId?: string | null;
            /** Preparedat */
            preparedAt?: string | null;
            /**
             * Title
             * @description From the provenance file (LS7).
             */
            title?: string | null;
            /**
             * Contextlength
             * @description The context it was prepared for, from the provenance file (LS7).
             */
            contextLength?: number | null;
            /**
             * Mode
             * @description How the engine runs it, in the engine's words, from the provenance file (LS7).
             */
            mode?: string | null;
            /**
             * Files
             * @description The files it is made of beside its source model, each measured
             *     on this host where the Library sees it (LS7).
             */
            files?: components["schemas"]["PreparedFile"][] | null;
            /**
             * Diskbytes
             * @description What its own files take on disk, the shared ones counted too,
             *     measured on this host (LS7). Absent when they are not on the
             *     Library's machine.
             */
            diskBytes?: number | null;
            /**
             * Missing
             * @description Each fact the Library could not give, and why (LS7, Troy: the
             *     Library imparts what is known, and names what is not).
             */
            missing?: components["schemas"]["PreparedFactMissing"][] | null;
        };
        /**
         * PreparedFactMissing
         * @description A fact about a prepared model the Library could not give, and why.
         */
        PreparedFactMissing: {
            /**
             * Fact
             * @description Which (`architecture`, `contextLength`, `diskBytes`, `source`, ...).
             */
            fact: string;
            /** Reason */
            reason: string;
        };
        /**
         * PreparedFile
         * @description One file a prepared model is made of (LS7).
         */
        PreparedFile: {
            /**
             * Path
             * @description Relative to the folder holding the provenance file, with `/`.
             */
            path: string;
            /** Sizebytes */
            sizeBytes?: number | null;
            /**
             * Shared
             * @description Used by other models the same engine prepared in this folder too
             *     (Strata's MTP helper): kept while any of them is.
             * @default false
             */
            shared: boolean | null;
        };
        /**
         * PreparedProvenance
         * @description The file `<name>.eugene-prepared.json` that makes an engine's
         *     prepared files a library model (`ModelFormat` `prepared`;
         *     library-sources-and-engines.md §4.5, Troy's L6). A plain JSON
         *     file in a Library folder, in the person's own layout like every
         *     other model file, and the prepared model's `LibraryModel.path`.
         *
         *     Written by the library's `POST /v1/models/prepared` when a person
         *     adopts a model prepared outside Eugene, and by a preparation job
         *     (LS5). Read by the library's scan, which lists a `prepared` model
         *     from it, and by the agent at every launch, which hands the engine
         *     its entry file. Nothing reads the engine's own files beyond what
         *     launching them needs: they stay usable without the library
         *     parsing them (experimental-engines.md).
         *
         *     A reader keeps and ignores fields it does not know, so a newer
         *     Eugene can add some; a `formatVersion` above the one it knows
         *     means the file was written by a newer Eugene, and the model is
         *     listed as unreadable rather than guessed at.
         */
        PreparedProvenance: {
            /**
             * Formatversion
             * @description The layout of this file. Absent means 1, the only one so far.
             */
            formatVersion?: number | null;
            /** @description The engine it was prepared for. Only that engine loads it. */
            engine: components["schemas"]["EngineKind"];
            /**
             * Entry
             * @description The engine's own entry file: for Strata, its JSON
             *     configuration, which names the pack, tokenizer and MTP files.
             *     Relative to the folder holding this file, or absolute. A
             *     relative entry travels with the folder (through a node's
             *     `pathMappings`, like any model path); an absolute one is a
             *     path on the node that runs the model, used as written,
             *     because an engine's prepared files belong on that node's own
             *     fast drive.
             */
            entry: string;
            /**
             * Recipe
             * @description The preparation that made it (`ModelPreparation.recipe`, e.g.
             *     `strata-prepare`). Absent: it was made outside Eugene and
             *     adopted as it is.
             */
            recipe?: string | null;
            /**
             * Recipeversion
             * @description The recipe's or engine's version that made it, e.g. Strata `v0.1.39`.
             */
            recipeVersion?: string | null;
            source?: components["schemas"]["PreparedSource"] | null;
            /**
             * Preparedat
             * @description When this file was written.
             */
            preparedAt?: string | null;
            /**
             * Title
             * @description What it is, in the engine's list's words when it came from the
             *     list (`SupportedModel.title`), e.g. `Qwen3.8-Flash-Next IQ2_XS`
             *     (LS7, B22 replaced).
             */
            title?: string | null;
            /**
             * Architecture
             * @description The architecture of the model it was made from, as the hub or
             *     the source file read it (`qwen4exp`): kept for when the source
             *     model is no longer in the Library.
             */
            architecture?: string | null;
            /**
             * Quantization
             * @description The engine's name for the size it was made from, e.g. `IQ2_XS`.
             */
            quantization?: string | null;
            /**
             * Contextlength
             * @description The context, in tokens, it was prepared for: an engine that fixes
             *     the context when it prepares (Strata's `--max-context`).
             */
            contextLength?: number | null;
            /**
             * Mode
             * @description How the engine runs it on the node that prepared it, in the
             *     engine's own words (Strata: *every expert in RAM*, *a RAM budget
             *     of its experts, the rest from the SSD*, *the low-RAM mode*).
             */
            mode?: string | null;
            /**
             * Files
             * @description Every file the model is made of beside its source model and
             *     this provenance file, the entry first, as the engine's adapter
             *     read them off its entry file: what is the model's own on disk.
             *     The source model's files are its own model's, not listed.
             */
            files?: components["schemas"]["PreparedFile"][] | null;
        } & {
            [key: string]: unknown;
        };
        /**
         * PreparedRequest
         * @description The engine's node has prepared the model: list it (LS5). The library
         *     writes the provenance file beside the entry, as *Add a prepared model*
         *     does, and the operation goes on with the prepared model.
         */
        PreparedRequest: {
            /** Lease */
            lease: string;
            /** Name */
            name: string;
            /** @description `entry` is the engine's entry file as this library spells it, inside a Library folder. */
            provenance: components["schemas"]["PreparedProvenance"];
        };
        /**
         * PreparedSource
         * @description What a prepared model was made from, as far as it is known. Every
         *     field is optional: a model adopted from outside Eugene may say
         *     nothing, and "not known" is shown as such.
         */
        PreparedSource: {
            /**
             * Path
             * @description The source model's `LibraryModel.path`, when it is a library
             *     model. The library links the two by it (`PreparedDetail.sourceModelId`).
             */
            path?: string | null;
            /**
             * Repoid
             * @description The hub repo it came from, e.g. `ISTA-DASLab/Qwen3.8-Flash-Next-GGUF`.
             */
            repoId?: string | null;
            /**
             * File
             * @description The repo-relative file, for a GGUF (its first shard when split).
             */
            file?: string | null;
            /**
             * Revision
             * @description The repo commit.
             */
            revision?: string | null;
        } & {
            [key: string]: unknown;
        };
        /**
         * ProfileBuiltAccuracy
         * @description The accuracy level the build was asked for; the agent's `ProfileBuildAccuracy`.
         * @enum {string}
         */
        ProfileBuiltAccuracy: "max" | "high" | "medium" | "low";
        /**
         * ProfileBuiltBy
         * @description What the settings builder set on a profile, and what it measured,
         *     on which machine. The UI compares `flags` with the profile's own
         *     flags to say which settings the builder set and whether any has
         *     been edited since; once one has, the measured numbers no longer
         *     describe the profile and are labelled so.
         */
        ProfileBuiltBy: {
            /**
             * Buildid
             * @description The agent's `ProfileBuild.id`.
             */
            buildId: string;
            /**
             * Node
             * @description The machine it was measured on.
             */
            node: string;
            accuracy: components["schemas"]["ProfileBuiltAccuracy"];
            /**
             * Builtat
             * Format: date-time
             */
            builtAt: string;
            /**
             * Engineversion
             * @description The llama.cpp build it was measured with.
             */
            engineVersion?: string | null;
            /**
             * Flags
             * @description The flags the builder set, as it set them: `contextSize`,
             *     `cacheType`, `flashAttention` when the cache is quantised,
             *     and `memoryMargin` when a margin was asked for. `gpuLayers`
             *     is never among them: placement is llama.cpp's at every launch.
             */
            flags: {
                [key: string]: unknown;
            };
            /**
             * Decodetokenspersecond
             * @description Measured decode speed with an empty context.
             */
            decodeTokensPerSecond?: number | null;
            /**
             * Deepdepth
             * @description The context depth of the second measurement (2,048 for every candidate).
             */
            deepDepth?: number | null;
            /** Deepdecodetokenspersecond */
            deepDecodeTokensPerSecond?: number | null;
            /**
             * Graphicsmemorybytes
             * @description Graphics memory used when the result was loaded to confirm it, where the machine can measure it.
             */
            graphicsMemoryBytes?: number | null;
            /**
             * Sametoptokenpercent
             * @description How often the chosen cache picks the same next token as the
             *     f16 cache on the evaluation text. Null when the f16 cache was
             *     chosen, since nothing that changes answers was set.
             */
            sameTopTokenPercent?: number | null;
            /** @description Which text the quality measurement used; null when none was made. */
            evaluationSource?: components["schemas"]["ProfileBuiltEvaluationSource"] | null;
        };
        /**
         * ProfileBuiltEvaluationSource
         * @description The agent's `EvaluationTextSource`. A custom text is identified by the build, never stored.
         * @enum {string}
         */
        ProfileBuiltEvaluationSource: "bundled" | "custom";
        /** ProfileRequest */
        ProfileRequest: {
            /** Lease */
            lease: string;
            /** Engine */
            engine: string;
            /** Contextsize */
            contextSize?: number | null;
        };
        /**
         * RecommendedSampling
         * @description Sampling parameters the model's author put in the file
         *     (`general.sampling.*` in GGUF). **Reported, never applied.**
         *
         *     The locked rule is that the gateway owns every
         *     LLM-output-affecting parameter and no component substitutes a
         *     local default; that rule is unchanged. But the file having an
         *     opinion is real information, and dropping it means the operator
         *     has to go read the model card to find out. Whether anything can
         *     adopt these with one click is a gateway decision, not a library
         *     one.
         */
        RecommendedSampling: {
            /** Temperature */
            temperature?: number | null;
            /** Topk */
            topK?: number | null;
            /** Topp */
            topP?: number | null;
        };
        /**
         * SafetensorsDetail
         * @description Safetensors-specific metadata. Present iff `format` is
         *     `safetensors`. **No quant tier** — a safetensors model is
         *     sized, not tiered. The one exception to "no quant fields" is
         *     `mlxQuantization` below, which is a conversion marker rather
         *     than a tier: it says which loader the directory was prepared
         *     for, not how good the weights are.
         */
        SafetensorsDetail: {
            mlxQuantization?: components["schemas"]["MlxQuantization"] | null;
            /**
             * Dtype
             * @description Dominant tensor dtype as the header declares it, e.g.
             *     `"BF16"`, `"F16"`, `"F32"`. The nearest thing to a quant
             *     tier here, and it is a precision rather than a scheme.
             */
            dtype?: string | null;
            /**
             * Shardcount
             * @description Number of `model-0000N-of-0000M.safetensors` files. Unlike
             *     GGUF, all of them are loaded together and none is "the"
             *     file — the directory is the model.
             */
            shardCount?: number | null;
            /**
             * Repoid
             * @description HuggingFace repo this came from, e.g.
             *     `"sentence-transformers/all-MiniLM-L6-v2"`, when the layout
             *     says so (a `models--<org>--<name>` cache directory, or
             *     `config.json` naming it).
             */
            repoId?: string | null;
            /**
             * Revision
             * @description Snapshot revision, when the model sits in a HuggingFace
             *     cache. Those caches hold **one directory per revision**, so
             *     without this two snapshots of one model are two
             *     indistinguishable entries. The revision named by the
             *     cache's own `refs/main` is the current one; the others are
             *     reported as skipped older revisions rather than as models.
             */
            revision?: string | null;
            /**
             * Configpath
             * @description Absolute path to `config.json`, the file that made this a model.
             */
            configPath?: string | null;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    list_operations_v1_run_operations_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationList"];
                };
            };
        };
    };
    assigned_v1_run_operations_assigned_get: {
        parameters: {
            query?: {
                node?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OperationList"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_operation_v1_run_operations__id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Operation"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    submit_v1_run_operations__id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Intent"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Operation"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    dismiss_v1_run_operations__id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    answer_v1_run_operations__id__answer_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Answer"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Operation"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    cancel_v1_run_operations__id__cancel_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Operation"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    claim_v1_run_operations__id__claim_post: {
        parameters: {
            query?: {
                node?: string | null;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClaimedOperation"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    checkpoint_v1_run_operations__id__checkpoint_post: {
        parameters: {
            query?: {
                node?: string | null;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Checkpoint"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Operation"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    profile_v1_run_operations__id__profile_post: {
        parameters: {
            query?: {
                node?: string | null;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProfileRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Operation"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    prepared_model_v1_run_operations__id__prepared_post: {
        parameters: {
            query?: {
                node?: string | null;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreparedRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Operation"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
