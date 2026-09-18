# CLENQO — Media & Storage

**Status:** Source of Truth
**Scope:** Media assets, file uploads, Supabase Storage, storage organization, access control, transformations, lifecycle, retention, privacy, and media processing
**Architecture:** Next.js 16 + React 19 + TypeScript + Supabase Storage + PostgreSQL
**Primary Principle:** Files are stored, accessed, processed, and retained through explicit ownership and authorization rules; storage paths must never become an authorization mechanism by themselves.

---

## 1. Purpose

This document defines how CLENQO manages files and media.

Media may be used for:

* public website images;
* CMS assets;
* service imagery;
* branch branding;
* customer booking attachments;
* cleaner job evidence;
* incident photos;
* quality inspections;
* employee documents;
* invoices and financial documents;
* future videos and other assets.

The storage architecture must support a single centralized platform with many branches while maintaining strict separation between public and private content.

---

# 2. Core Principle

CLENQO follows:

```text
Upload
  ↓
Validate
  ↓
Authorize
  ↓
Assign ownership/scope
  ↓
Store
  ↓
Record metadata
  ↓
Serve through controlled access
```

A file existing in storage does not automatically mean that a user is allowed to access it.

---

# 3. Storage Provider

The initial storage provider is:

**Supabase Storage**

It integrates with the existing:

* Supabase project;
* PostgreSQL;
* authentication;
* RLS;
* server-side application architecture.

A provider abstraction may be introduced later if multiple storage providers become necessary.

---

# 4. Storage Categories

CLENQO should distinguish at least:

### Public CMS Media

Examples:

* website hero images;
* service images;
* branch images;
* logos;
* public promotional media.

### Private Operational Media

Examples:

* cleaner evidence photos;
* incident photos;
* quality inspection evidence.

### Private Customer Media

Examples:

* customer-uploaded booking attachments.

### Private Employee Media

Examples:

* employment documents;
* permitted employee records.

### Financial Documents

Examples:

* invoices;
* receipts;
* financial attachments.

These categories must not share identical access policies.

---

# 5. Public vs Private Storage

Storage objects should be classified as either:

```text
public
```

or:

```text
private
```

### Public

Can be served publicly when approved for publication.

### Private

Requires an authorized access path, typically through authenticated server logic or signed URLs.

Private files must never be exposed through predictable public URLs.

---

# 6. Storage Buckets

The implementation may use separate buckets based on security and lifecycle requirements.

Conceptual structure:

```text
public-media
private-media
documents
evidence
```

The exact bucket structure should be finalized during implementation.

Avoid creating excessive buckets without a security or lifecycle reason.

---

# 7. Storage Metadata

Database metadata should identify important information about stored files.

Conceptually:

```text
media_asset
├── id
├── organization_id
├── branch_id
├── owner_type
├── owner_id
├── storage_bucket
├── storage_path
├── file_name
├── mime_type
├── file_size
├── width
├── height
├── alt_text
├── visibility
├── status
├── uploaded_by
├── created_at
└── updated_at
```

The exact schema remains subject to database implementation.

---

# 8. Database Is Metadata Source of Truth

Storage contains file bytes.

PostgreSQL contains authoritative application metadata and relationships.

Therefore:

```text
Storage
→ bytes

PostgreSQL
→ ownership
→ scope
→ purpose
→ metadata
→ lifecycle
→ relationships
```

Do not rely exclusively on storage paths to understand business ownership.

---

# 9. Ownership

Every important private asset should have explicit ownership or scope.

Possible ownership:

```text
organization
branch
booking
job
customer
employee
quality_check
incident
invoice
```

This allows authorization to be evaluated against the related business object.

---

# 10. Branch Scope

Branch-owned files must contain branch scope.

Example:

```text
branch_id = Berlin
```

A Branch Manager must not access:

```text
branch_id = Hamburg
```

simply by manipulating a storage path.

---

# 11. Organization Scope

Organization-level assets must be scoped to the organization.

Cross-organization access must be prevented through:

* application authorization;
* storage policies;
* database relationships;
* RLS.

---

# 12. Storage Path Design

Storage paths should be predictable enough for management but not treated as security credentials.

Conceptual:

```text
{organization}/{branch}/{asset-type}/{resource}/{asset-id}/{file}
```

Example:

```text
org_x/branch_y/jobs/job_z/evidence/photo-01.jpg
```

The exact path convention will be finalized during implementation.

---

# 13. Path Security

Do not allow users to freely provide complete storage paths.

The server should construct paths from validated identifiers.

Reject:

```text
../
absolute paths
unexpected prefixes
arbitrary bucket names
```

Storage paths must be generated by controlled application logic.

---

# 14. Filename Handling

Original filenames are untrusted input.

The system should:

* normalize or sanitize names;
* prevent path traversal;
* prevent problematic characters;
* avoid collisions;
* generate safe storage object names.

Original filename may be preserved as metadata for user display.

---

# 15. File Type Validation

Uploads must validate both:

* declared MIME type;
* actual file characteristics where practical.

Do not rely exclusively on:

```text
file extension
```

or:

```text
Content-Type header
```

because both can be manipulated.

---

# 16. Allowed File Types

Initial allowed types should be deliberately limited.

Typical public media:

```text
image/jpeg
image/png
image/webp
image/avif
```

Potential future:

```text
image/svg+xml
video/*
application/pdf
```

Additional formats require explicit security review.

---

# 17. SVG Security

SVG files can contain active content.

If SVG uploads are supported, they require controlled sanitization or another safe processing strategy.

Untrusted SVG must not automatically become executable browser content.

For the initial system, raster image formats may be preferred unless SVG support is specifically required.

---

# 18. File Size Limits

Every upload category must have a maximum size.

Examples:

```text
CMS image → moderate limit
job evidence → smaller limit
employee document → controlled limit
video → larger explicit limit
```

The exact values should be configured according to actual requirements.

No endpoint should accept unlimited uploads.

---

# 19. Image Dimensions

Image uploads may validate:

* width;
* height;
* aspect ratio;
* total pixel count.

This helps prevent malicious or accidental oversized images.

---

# 20. Image Optimization

Public images should be optimized where practical.

Possible operations:

* resizing;
* compression;
* format conversion;
* thumbnail generation;
* responsive variants.

Optimization should not modify the original when preservation is required.

---

# 21. Responsive Image Variants

Public CMS images may eventually have variants such as:

```text
thumbnail
small
medium
large
original
```

The frontend should use appropriate sizes for the viewport.

This improves performance and reduces bandwidth.

---

# 22. Media Processing

Media processing may become asynchronous.

Example:

```text
Upload
 ↓
Create media record
 ↓
Queue processing
 ↓
Optimize
 ↓
Generate variants
 ↓
Mark ready
```

The user should not be forced to wait for expensive processing if it can safely happen in the background.

---

# 23. Processing Status

Media may use states such as:

```text
pending
processing
ready
failed
archived
```

Public content should not reference media that is not ready.

---

# 24. CMS Media

CMS media should support:

* upload;
* preview;
* alt text;
* title/caption where needed;
* replacement;
* archive;
* usage information;
* branch scope;
* public/private classification.

Only authorized CMS users may manage CMS media.

---

# 25. Master vs Branch Media

The centralized platform may contain:

### Master media

Owned by HQ/platform.

### Branch media

Owned by an individual branch.

Master media may be available to branches according to approved governance.

Branches must not modify protected master assets directly.

---

# 26. Branch Branding

Branch-specific assets may include:

* local team imagery;
* branch photos;
* local promotional images;
* approved local logos where permitted.

Core CLENQO identity remains controlled by HQ according to the design system.

---

# 27. Cleaner Evidence

Cleaners may upload permitted evidence photos for:

* completed work;
* before/after evidence;
* incidents;
* quality checks.

Evidence must be linked to the relevant:

```text
job
booking
branch
employee
```

where applicable.

---

# 28. Evidence Privacy

Cleaner evidence may contain:

* customer property;
* personal belongings;
* addresses;
* people;
* private documents.

Therefore evidence must be treated as private by default.

It must not be included in public website media.

---

# 29. Customer Uploads

Customer uploads should be restricted to approved booking workflows.

Examples:

* access instructions;
* property-related information;
* specific cleaning requirements.

Customer files must remain scoped to the customer/booking relationship.

---

# 30. Employee Documents

Employee documents are highly restricted.

Access should be limited to authorized personnel.

They should not be available to:

* customers;
* cleaners outside their permitted scope;
* public users;
* ordinary CMS users.

---

# 31. Financial Documents

Invoices and related financial documents require controlled access.

A customer may access their own permitted invoice.

Branch finance users may access authorized branch documents.

HQ finance users may access authorized organization-level financial documents.

---

# 32. Signed URLs

Private files may be served using short-lived signed URLs.

A signed URL should:

* expire;
* grant only the intended object access;
* not be reused as permanent authorization;
* be generated only after authorization.

Possession of a signed URL should be treated as sensitive.

> **Resolved (BD-C4 — Change 7 decision record):** the Cleaner PWA (Change 7)
> uses exactly this model for its V1 photo categories (before / after /
> incident-evidence): private bucket, job-scoped paths, per-category
> size/type allow-lists configured in the Media Storage implementation,
> short-lived signed URLs generated only after Cleaner-scope authorization,
> and no public exposure path. Offline photo upload is out of scope for V1.
> **Implemented (Change 7):** `features/worker/media.ts` issues signed URLs
> only after active-assignment authorization; the bucket name comes from
> `SUPABASE_MEDIA_BUCKET` configuration (default `media`); `job_media` rows
> (migration `0013_cleaner_execution.sql`) enforce category, incident
> linkage for `incident_evidence`, and per-job deduplication.

---

# 33. Server-Mediated Access

For especially sensitive operations, the application may mediate access through the server instead of directly exposing storage URLs.

This is useful when additional:

* authorization;
* logging;
* transformation;
* redaction;
* business validation

is required.

---

# 34. Storage RLS and Policies

Storage policies must align with application ownership and authorization.

Conceptually:

```text
User
 ↓
Auth
 ↓
Application Authorization
 ↓
Storage Policy
 ↓
Object
```

Storage policy design must not assume that a path alone proves authorization.

---

# 35. Deletion

Deletion must distinguish:

```text
remove from public usage
```

from:

```text
permanently delete file
```

Some business records may require retention even after the file is no longer publicly used.

---

# 36. Archive

Media may be archived instead of immediately deleted.

Example:

```text
active
→ archived
```

Archived media should not normally appear in active CMS selectors.

---

# 37. Orphan Detection

The system should eventually identify files that are:

```text
stored
but no longer referenced
```

These may be candidates for cleanup after an appropriate retention period.

Automatic deletion must be conservative.

---

# 38. Replacement

When a CMS user replaces an image:

```text
old asset
→ retained/archived
new asset
→ active
```

Do not immediately destroy the old asset if revision/history or rollback requires it.

---

# 39. Media References

CMS sections should reference media by internal asset ID rather than embedding raw storage paths everywhere.

Example:

```text
image_asset_id
```

This allows:

* replacement;
* metadata management;
* authorization;
* transformations;
* storage migration.

---

# 40. Public Rendering

The public website should render only media that is:

```text
authorized for public use
+
published
+
ready
```

Private media must never accidentally render through CMS content.

---

# 41. Media and Localization

Media may have localized metadata:

* alt text;
* captions;
* descriptions.

The file itself may be shared across locales.

Example:

```text
image
├── de alt text
├── en alt text
├── fr alt text
└── es alt text
```

Localized metadata should remain separate from file storage.

---

# 42. Accessibility

Public images must support appropriate alternative text.

CMS should distinguish:

```text
decorative image
```

from:

```text
informative image
```

The system should prevent publication of important images without required accessibility metadata where appropriate.

---

# 43. Image Security

Uploaded images should be treated as untrusted.

Where necessary, processing should:

* strip unsafe metadata;
* normalize formats;
* limit dimensions;
* prevent decompression abuse;
* reject malformed files.

EXIF/GPS metadata should be handled carefully because it may reveal sensitive location information.

---

# 44. Metadata Privacy

Publicly served media should not unintentionally expose:

* GPS coordinates;
* device identifiers;
* private author metadata;
* unnecessary EXIF information.

Public image processing should remove sensitive metadata where appropriate.

---

# 45. Upload Authorization

Before an upload, the server must establish:

```text
who is uploading?
what are they uploading?
for which organization?
for which branch?
for which resource?
is this operation allowed?
```

The browser must not decide these values authoritatively.

---

# 46. Upload Flow

Recommended flow:

```text
Client selects file
       ↓
Client-side basic validation
       ↓
Server authorization
       ↓
Server validation
       ↓
Generate controlled storage target
       ↓
Upload
       ↓
Persist media metadata
       ↓
Process if required
       ↓
Return safe media reference
```

---

# 47. Direct Uploads

Direct-to-storage uploads may be used for larger files to improve performance.

However, authorization and upload constraints must still be enforced.

A signed upload mechanism may be used where appropriate.

---

# 48. Upload Abortion

Incomplete or abandoned uploads should not create permanent orphaned assets.

Temporary upload records may be cleaned up by background jobs.

---

# 49. Virus/Malware Scanning

If CLENQO eventually supports arbitrary documents or high-risk file types, malware scanning should be considered.

Priority is higher for:

* PDFs;
* office documents;
* archives;
* customer-uploaded files;
* employee documents.

Image-only workflows may require less infrastructure initially.

---

# 50. Documents

Document storage should be treated more strictly than ordinary website images.

Examples:

```text
employee contracts
tax documents
financial documents
customer attachments
```

Documents should generally be private.

---

# 51. File Access Logging

High-sensitivity file access may be logged.

Potential events:

```text
media.uploaded
media.viewed
media.downloaded
media.replaced
media.archived
media.deleted
```

Do not create excessive logging for ordinary public image requests.

---

# 52. Audit

Important media mutations should produce audit records.

Examples:

```text
employee_document.uploaded
employee_document.deleted
website_media.published
job_evidence.uploaded
private_media.accessed
```

The exact audit policy depends on sensitivity.

---

# 53. Storage Performance

Public media delivery should use caching/CDN capabilities where available.

The architecture should support:

* browser caching;
* CDN caching;
* optimized image delivery;
* responsive variants.

Private content must not be accidentally cached publicly.

---

# 54. Cache-Control

Public and private media require different caching strategies.

Public:

```text
long-lived caching may be appropriate
```

Private:

```text
short-lived or controlled caching
```

Never expose private content through a public cache.

---

# 55. Storage Costs

Storage costs should be monitored by category.

Potential categories:

```text
CMS
job evidence
documents
customer uploads
financial documents
```

Large media growth should be visible to platform administration.

---

# 56. Retention

Retention policies should distinguish asset types.

Examples:

```text
public CMS assets
job evidence
employee documents
financial documents
customer attachments
```

Retention must consider:

* business requirements;
* legal obligations;
* privacy;
* dispute handling;
* audit requirements.

Exact legal retention periods require jurisdiction-specific review.

---

# 57. GDPR-Oriented Design

CLENQO should support privacy requirements such as:

* data minimization;
* purpose limitation;
* controlled access;
* retention;
* deletion where permitted;
* export where required;
* access requests;
* secure processing.

This is architectural guidance, not legal advice.

---

# 58. Personal Data in Images

Images may contain personal data even when the filename does not.

Examples:

* faces;
* documents;
* addresses;
* personal possessions;
* screens;
* license plates.

Operational users should be instructed to upload only relevant evidence.

---

# 59. Public Media Moderation

Before publishing user- or branch-provided media publicly, appropriate authorization and moderation should apply.

A file being uploaded does not mean:

```text
approved for public display.
```

---

# 60. Media Status

A useful lifecycle is:

```text
uploaded
processing
ready
published
archived
deleted
```

Not every asset needs every state.

---

# 61. Media Usage Tracking

The CMS should eventually show where an asset is used.

Example:

```text
hero section
Berlin homepage
service page
FAQ section
```

This reduces accidental deletion of active assets.

---

# 62. Broken Media

The system should detect:

* missing storage objects;
* missing metadata;
* inaccessible assets;
* processing failures.

Public pages should have graceful fallbacks rather than broken layouts.

---

# 63. Storage Provider Abstraction

The application may define an internal storage interface.

Conceptually:

```ts
interface StorageProvider {
  upload(...): Promise<StorageObject>;
  delete(...): Promise<void>;
  createSignedUrl(...): Promise<string>;
}
```

Supabase Storage implements the initial provider.

This should be introduced only where it provides meaningful architectural value.

---

# 64. No Storage Logic in UI

React components must not contain storage authorization logic.

The UI may:

* select files;
* display upload progress;
* show previews.

Server-side logic owns:

* authorization;
* storage path;
* bucket;
* ownership;
* security;
* metadata persistence.

---

# 65. Media and Branch Provisioning

Branch provisioning may create:

* branch media configuration;
* default media associations;
* approved master assets;
* branch-specific media folders/prefixes.

It must not duplicate the entire master media library unnecessarily.

---

# 66. Media and CMS Inheritance

Branch websites may inherit approved master assets.

Example:

```text
Master hero image
        ↓
Branch website uses inherited asset
```

A branch may replace it with an approved local asset without modifying the master asset.

---

# 67. Media and Jobs

Job evidence should be connected to jobs rather than stored as generic media.

Example:

```text
Job
 ├── before photos
 ├── after photos
 ├── incident photos
 └── quality evidence
```

This makes authorization and retention easier.

---

# 68. Media and Reviews

Customer review images, if supported in the future, should be:

* explicitly consented where required;
* moderated;
* linked to the review;
* stored according to public/private status.

Do not automatically publish customer-uploaded media.

---

# 69. Media and Notifications

Notification attachments should be generated through controlled server processes.

Do not expose internal storage paths directly in emails.

Signed or public URLs should be used according to the asset's access classification.

---

# 70. Media and Background Jobs

Background jobs may handle:

* optimization;
* thumbnails;
* cleanup;
* orphan detection;
* malware scanning;
* document processing;
* metadata normalization.

These jobs must be idempotent and observable.

---

# 71. Storage Monitoring

Monitor:

```text
total storage
growth rate
file count
failed uploads
processing failures
orphaned files
private/public distribution
```

Monitor especially large or unexpected growth.

---

# 72. Storage Alerts

Potential alerts:

* unusual storage growth;
* repeated upload failures;
* media processing backlog;
* storage provider errors;
* private/public policy errors;
* excessive orphaned files.

Alerts should be actionable.

---

# 73. Testing

Storage tests must cover:

### Upload

* valid file;
* invalid MIME;
* oversized file;
* malformed file.

### Authorization

* authorized upload;
* unauthorized upload;
* cross-branch access;
* cross-organization access.

### Access

* public asset;
* private asset;
* expired signed URL;
* unauthorized private asset.

### Lifecycle

* archive;
* replacement;
* deletion;
* orphan cleanup.

### Security

* path traversal;
* malicious filenames;
* unsafe file types;
* metadata leakage.

---

# 74. MVP Media & Storage

The MVP should include:

* Supabase Storage;
* public CMS media;
* private operational media foundation;
* media metadata in PostgreSQL;
* upload validation;
* size limits;
* controlled storage paths;
* branch/organization scope;
* RLS/storage policies;
* signed access for private files;
* CMS media manager foundation;
* basic image optimization;
* audit for important media changes.

---

# 75. Future Media Capabilities

Future capabilities may include:

* advanced image transformations;
* video;
* document previews;
* malware scanning;
* OCR;
* AI image tagging;
* AI alt-text generation;
* duplicate detection;
* advanced media search;
* CDN optimization;
* automated retention;
* media usage analytics.

AI-generated metadata must remain reviewable and must never override security or authorization.

---

# 76. Architecture Rules

The following are mandatory:

1. Storage is not an authorization mechanism by itself.
2. Every important private asset has explicit ownership/scope.
3. Organization scope must be enforced.
4. Branch scope must be enforced.
5. Public and private media are clearly separated.
6. Uploads are untrusted input.
7. File type and size must be validated.
8. Storage paths are server-controlled.
9. Private files require controlled access.
10. Signed URLs must be short-lived where appropriate.
11. Storage metadata belongs in PostgreSQL.
12. Sensitive files require stronger access controls.
13. Customer and employee files are private by default.
14. Operational evidence is private by default.
15. Public media must be explicitly approved for publication.
16. Media processing must not weaken authorization.
17. Background media jobs must be idempotent.
18. Important media mutations must be auditable.
19. Private media must not be publicly cached.
20. Retention and deletion must be deliberate.
21. Media architecture must support multiple branches without duplicated codebases.
22. AI media features must operate only on authorized data.

---

# 77. Definition of Done

A media/storage feature is complete when:

* [ ] File purpose is defined.
* [ ] Public/private classification is defined.
* [ ] Ownership is defined.
* [ ] Organization scope is defined.
* [ ] Branch scope is defined.
* [ ] Upload authorization exists.
* [ ] File validation exists.
* [ ] Size limits exist.
* [ ] Storage path is controlled.
* [ ] Storage policy/RLS is verified.
* [ ] Private access is protected.
* [ ] Metadata is persisted.
* [ ] Lifecycle is defined.
* [ ] Retention behavior is defined.
* [ ] Sensitive metadata is handled.
* [ ] Audit requirements are implemented.
* [ ] Observability exists.
* [ ] Security tests exist.
* [ ] Failure/retry behavior exists where applicable.
* [ ] Documentation is synchronized.
* [ ] OpenSpec acceptance criteria pass.

---

# 78. Golden Storage Rule

> **Every file must have a clear purpose, owner, scope, visibility, lifecycle, and authorization path; storage must support the business system rather than become an uncontrolled source of data exposure.**
