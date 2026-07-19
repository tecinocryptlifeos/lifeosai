# LifeOS Queue Foundation v1.0.1

Human-facing name: **LifeOS Queue**

Technical identifier: `lifeos_queue`

This package prepares the inactive database migration, queue policy module,
tests, and operating record. It does not send email, apply the Supabase
migration, push GitHub, deploy Render, or change the public interface.

Policy:
- 10 messages daily
- 30-minute outbound spacing
- 15-minute reply synchronization
- 3 maximum attempts
- disabled by default
