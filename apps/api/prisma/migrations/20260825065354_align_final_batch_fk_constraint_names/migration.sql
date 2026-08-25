-- RenameForeignKey
ALTER TABLE "final_quality_batch_allocations" RENAME CONSTRAINT "final_quality_batch_allocations_batch_id_fkey" TO "final_quality_batch_allocations_final_quality_batch_id_fkey";

-- RenameForeignKey
ALTER TABLE "final_quality_batch_allocations" RENAME CONSTRAINT "final_quality_batch_allocations_size_id_fkey" TO "final_quality_batch_allocations_job_order_line_size_id_fkey";

-- RenameForeignKey
ALTER TABLE "qa_release_lines" RENAME CONSTRAINT "qa_release_lines_release_id_fkey" TO "qa_release_lines_qa_release_id_fkey";

-- RenameForeignKey
ALTER TABLE "qa_releases" RENAME CONSTRAINT "qa_releases_source_execution_id_fkey" TO "qa_releases_source_quality_execution_id_fkey";
