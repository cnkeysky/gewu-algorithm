use gewu_domain::ContentStatus;
use thiserror::Error;

/// Validates one explicit content lifecycle transition.
pub fn validate_transition(from: ContentStatus, to: ContentStatus) -> Result<(), LifecycleError> {
    let valid = matches!(
        (from, to),
        (ContentStatus::Draft, ContentStatus::Reviewed)
            | (ContentStatus::Reviewed, ContentStatus::Validated)
            | (ContentStatus::Validated, ContentStatus::Deprecated)
            | (ContentStatus::Validated, ContentStatus::Revised)
            | (ContentStatus::Revised, ContentStatus::Reviewed)
    );
    if valid {
        Ok(())
    } else {
        Err(LifecycleError { from, to })
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
#[error("content lifecycle cannot transition from {from:?} to {to:?}")]
pub struct LifecycleError {
    pub from: ContentStatus,
    pub to: ContentStatus,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_review_validation_and_deprecation() {
        assert!(validate_transition(ContentStatus::Draft, ContentStatus::Reviewed).is_ok());
        assert!(validate_transition(ContentStatus::Reviewed, ContentStatus::Validated).is_ok());
        assert!(validate_transition(ContentStatus::Validated, ContentStatus::Deprecated).is_ok());
    }

    #[test]
    fn rejects_reactivation_without_revision() {
        assert!(validate_transition(ContentStatus::Deprecated, ContentStatus::Validated).is_err());
        assert!(validate_transition(ContentStatus::Draft, ContentStatus::Validated).is_err());
    }
}
