require "ostruct"

module UI
  def self.user_error!(message) = raise(message)
  def self.message(message); end
  def self.success(message); end
end

module Spaceship
  module ConnectAPI
    class App
      def self.find(identifier) = $store_app
    end
    class Build
      def self.all(**options)
        raise "Unexpected build selection" unless options[:version] == "26.0.10" && options[:build_number] == "10"
        [$store_build]
      end
    end
    class ReviewSubmissionItem
      def self.all(**options) = $ready_items
    end
  end
end

module Supply
  class Reader
    def track_release_summaries = [$play_release]
  end
end

class LaneTest
  attr_reader :uploads
  def initialize
    @lanes = {}
    @uploads = []
    instance_eval(File.read(File.join(__dir__, "Fastfile")), File.join(__dir__, "Fastfile"))
  end
  def platform(name, &block)
    @platform = name
    instance_eval(&block)
  end
  def desc(text); end
  def lane(name, &block) = @lanes[[@platform, name]] = block
  def app_store_connect_api_key(**options) = options
  def upload_to_app_store(**options) = @uploads << options
  def upload_to_play_store_review(**options) = @uploads << options
  def google_play_track_version_codes(**options) = $production_codes
  def run(platform) = instance_exec(&@lanes[[platform, :review]])
end

class StoreApp < OpenStruct
  def get_app_store_versions(**options) = versions
  def get_ready_review_submission(**options) = ready_submission
end

class ReviewDetail < OpenStruct
  def update(attributes:) = self.notes = attributes["notes"]
  def upload_attachment(path:) = self.attachment = path
end

class StoreVersion < OpenStruct
  def fetch_app_store_review_detail = review_detail
end

class StoreSubmission < OpenStruct
  def submit_for_review = self.submitted = true
end

def check(condition, message)
  raise message unless condition
end

def rejects(message)
  begin
    yield
  rescue RuntimeError => error
    check(error.message.include?(message), "Unexpected error: #{error.message}")
    return
  end
  raise "Expected failure: #{message}"
end

ENV.update({"MOBILE_VERSION" => "26.0.10", "MOBILE_BUILD_NUMBER" => "10", "MOBILE_VERSION_CODE" => "25",
  "MOBILE_APPLICATION_ID" => "com.supaterm.mobile", "MOBILE_STORE_ASSETS" => "/tmp/test-assets",
  "APPLE_API_KEY_ID" => "test-key", "APPLE_API_ISSUER" => "test-issuer", "APPLE_API_KEY" => "test-key-content",
  "GOOGLE_PLAY_JSON_KEY_PATH" => "/tmp/test-key.json",
  "MOBILE_REVIEW_INVITE_URL" => "https://review.example.test/review#invite=test", "MOBILE_REVIEW_QR_PATH" => "/tmp/review-qr.png"})
$store_build = OpenStruct.new(id: "exact-build", processing_state: "VALID", expired: false)
$store_app = StoreApp.new(id: "app", versions: [])
runner = LaneTest.new
runner.run(:ios)
check(runner.uploads.first[:build_number] == "10" && runner.uploads.first[:submit_for_review], "Exact iOS build was not submitted")
check(runner.uploads.first[:automatic_release] == false, "iOS manual publishing changed")
check(runner.uploads.first[:app_review_attachment_file] == "/tmp/review-qr.png", "iOS review QR was not attached")
notes = runner.uploads.first[:app_review_information][:notes]
check(notes.include?("review#invite=test") && notes.include?("attached QR code") && !notes.include?("{{"), "iOS review notes were not filled in")

%w[WAITING_FOR_REVIEW IN_REVIEW READY_FOR_DISTRIBUTION].each do |state|
  $store_app.versions = [OpenStruct.new(app_version_state: state, get_build: $store_build)]
  runner = LaneTest.new
  runner.run(:ios)
  check(runner.uploads.empty?, "An already submitted iOS build was uploaded again")
end
$store_app.versions = [OpenStruct.new(app_version_state: "IN_REVIEW", get_build: OpenStruct.new(id: "other-build"))]
rejects("different build") { LaneTest.new.run(:ios) }
$ready_detail = ReviewDetail.new(app_store_review_attachments: [])
$store_app.versions = [StoreVersion.new(id: "ready-version", app_version_state: "READY_FOR_REVIEW", get_build: $store_build, review_detail: $ready_detail)]
$store_app.ready_submission = StoreSubmission.new(id: "submission", submitted: false)
$ready_items = [OpenStruct.new(app_store_version: OpenStruct.new(id: "ready-version"))]
runner = LaneTest.new
runner.run(:ios)
check($store_app.ready_submission.submitted && runner.uploads.empty?, "Partial iOS submission was not resumed")
check($ready_detail.attachment == "/tmp/review-qr.png" && $ready_detail.notes.include?("review#invite=test"), "Resumed iOS submission skipped the review notes")
$ready_items = [OpenStruct.new(app_store_version: OpenStruct.new(id: "other-version"))]
rejects("other review items") { LaneTest.new.run(:ios) }
$store_build.processing_state = "INVALID"
rejects("rejected processing") { LaneTest.new.run(:ios) }

$production_codes = []
runner = LaneTest.new
runner.run(:android)
check(runner.uploads.first[:version_code] == 25 && runner.uploads.first[:track_promote_to] == "production", "Exact Android build was not promoted")
check(runner.uploads.first[:changes_not_sent_for_review] == false && runner.uploads.first[:rescue_changes_not_sent_for_review] == false, "Android review submission can silently fall back")
$production_codes = [25]
$play_release = OpenStruct.new(active_artifacts: [OpenStruct.new(version_code: 25)], release_lifecycle_state: "RELEASE_LIFECYCLE_STATE_IN_REVIEW")
runner = LaneTest.new
runner.run(:android)
check(runner.uploads.empty?, "An already submitted Android build was promoted again")
%w[RELEASE_LIFECYCLE_STATE_DRAFT RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW RELEASE_LIFECYCLE_STATE_NOT_APPROVED].each do |state|
  $play_release.release_lifecycle_state = state
  runner = LaneTest.new
  runner.run(:android)
  check(runner.uploads.length == 1 && runner.uploads.first[:track] == "production", "An unsubmitted Android release was skipped")
end
$play_release.release_lifecycle_state = "RELEASE_LIFECYCLE_STATE_UNSPECIFIED"
rejects("usable review state") { LaneTest.new.run(:android) }
puts "Store review behavior passed for both platforms."
