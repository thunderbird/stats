s3bucket ='s3://thunderbird-telemetry1/results/'
region = 'us-east-1'
# The first release version of Thunderbird that supported Telemetry.
first_version = 78
# List of recently released versions.
release_version = [78, 91, 102, 115, 128, 140]

# Add-ons to ignore when counting users.
ignore_addon_guids = [
    'wetransfer@extensions.thunderbird.net',
    'search.mozilla.org',
]

keyedscalars = [
    {'key': 'tb.account.count', 'combine':['facebook']},
    {'key': 'tb.account.successful_email_account_setup'},
    {'key': 'tb.account.failed_email_account_setup'},
    {'key': 'tb.filelink.uploaded_size'},
    {'key': 'tb.mails.read_secure'},
    {'key': 'tb.websearch.usage', 'combine':['google', 'wikipedia', 'amazon']},
    {'key': 'tb.addressbook.addressbook_count'},
#   {'key': 'tb.addressbook.contact_count'},
    {'key': 'tb.calendar.calendar_count'},
    {'key': 'tb.calendar.read_only_calendar_count'}
#    {'key': 'tb.ui.interaction.calendar', 'start': '2021-11-29'},
#    {'key': 'tb.ui.interaction.chat', 'start': '2021-11-29'},
#    {'key': 'tb.ui.interaction.keyboard', 'start': '2021-11-29'},
#    {'key': 'tb.ui.interaction.message_display', 'start': '2021-11-29'},
#    {'key': 'tb.ui.interaction.toolbox', 'start': '2021-11-29'}
]

scalars = [
    {'key': 'tb.compose.format_html'},
    {'key': 'tb.compose.format_plain_text'},
    {'key': 'tb.filelink.ignored'},
    {'key': 'tb.mails.sent'},
    {'key': 'tb.mails.read'},
]
