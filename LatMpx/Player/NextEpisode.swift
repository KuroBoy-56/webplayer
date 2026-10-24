import SwiftUI
import UIKit

/*
 * Siguiente capítulo como Netflix (igual en todas las apps): en los últimos 15 s aparece el aviso con la cuenta.
 * «Ver ahora» pasa ya; «Cancelar» deja ver el final y, al terminar, pasa solo al siguiente.
 */
enum NextEpisode {
    static let promptMs: Int64 = 15_000

    /** segundos que faltan para el siguiente capítulo, o 0 si el aviso no va */
    static func seconds(series: Bool, hasNext: Bool, dismissed: Bool, timeMs: Int64, lengthMs: Int64) -> Int {
        guard series, hasNext, !dismissed, lengthMs > 120_000, timeMs > 60_000 else { return 0 }
        let left = lengthMs - timeMs
        guard left > 0, left <= promptMs else { return 0 }
        return Int((left + 999) / 1000)
    }
}

/** el aviso en el reproductor de la app (VLC) */
struct NextEpisodeCard: View {
    let seconds: Int
    let watch: () -> Void
    let cancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(tr("Siguiente episodio")).font(.system(size: 17, weight: .bold))
            Text(tr("Empieza en %d s", seconds)).font(.system(size: 14)).foregroundColor(.white.opacity(0.7))
            HStack(spacing: 10) {
                Button(action: watch) {
                    Text(tr("Ver ahora")).font(.system(size: 15, weight: .bold)).padding(.horizontal, 16).padding(.vertical, 9)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 4))
                }
                Button(action: cancel) {
                    Text(tr("Cancelar")).font(.system(size: 15, weight: .bold)).padding(.horizontal, 16).padding(.vertical, 9)
                        .background(Color.white.opacity(0.2), in: RoundedRectangle(cornerRadius: 4))
                }
            }
            .padding(.top, 4)
        }
        .foregroundColor(.white)
        .padding(14)
        .background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 8))
    }
}

/** el mismo aviso sobre el reproductor de iOS (AVPlayerViewController) */
final class NativeNextCard: UIView {
    var onWatch: (() -> Void)?
    var onCancel: (() -> Void)?
    private let count = UILabel()

    init() {
        super.init(frame: .zero)
        backgroundColor = UIColor.black.withAlphaComponent(0.85)
        layer.cornerRadius = 8
        let title = UILabel()
        title.text = tr("Siguiente episodio")
        title.font = .boldSystemFont(ofSize: 17)
        title.textColor = .white
        count.font = .systemFont(ofSize: 14)
        count.textColor = UIColor.white.withAlphaComponent(0.7)
        let watch = button(tr("Ver ahora"), UIColor(Theme.accent)) { [weak self] in self?.onWatch?() }
        let cancel = button(tr("Cancelar"), UIColor.white.withAlphaComponent(0.2)) { [weak self] in self?.onCancel?() }
        let buttons = UIStackView(arrangedSubviews: [watch, cancel])
        buttons.spacing = 10
        let stack = UIStackView(arrangedSubviews: [title, count, buttons])
        stack.axis = .vertical
        stack.alignment = .leading
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 14), stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -14),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14), stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
        ])
    }

    required init?(coder: NSCoder) { nil }

    func set(seconds: Int) { count.text = tr("Empieza en %d s", seconds) }

    private func button(_ text: String, _ color: UIColor, _ action: @escaping () -> Void) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(text, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = .boldSystemFont(ofSize: 15)
        b.backgroundColor = color
        b.layer.cornerRadius = 4
        b.contentEdgeInsets = UIEdgeInsets(top: 9, left: 16, bottom: 9, right: 16)
        b.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return b
    }
}
